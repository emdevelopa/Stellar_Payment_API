import { describe, expect, it, vi } from "vitest";
import { createFakeRedis } from "../../tests/helpers/fake-redis.js";
import {
  paymentProcessorLockKey,
  withPaymentProcessorLock,
} from "./payment-processor-lock.js";

describe("payment processor distributed locking (issue #1480)", () => {
  it("hashes resource identifiers instead of exposing them in Redis keys", () => {
    const key = paymentProcessorLockKey("verify", "merchant-secret:payment-secret");
    expect(key).toMatch(/^lock:payment-processor:verify:[a-f0-9]{64}$/);
    expect(key).not.toContain("merchant-secret");
    expect(key).not.toContain("payment-secret");
  });

  it("serializes callers sharing a Redis lock and releases after completion", async () => {
    const redis = createFakeRedis();
    let releaseFirst;
    const first = withPaymentProcessorLock(
      "verify",
      "payment-1",
      () => new Promise((resolve) => { releaseFirst = resolve; }),
      { redisClient: redis, waitMs: 200, retryMs: 2, ttlMs: 1_000 },
    );
    await vi.waitFor(() => expect(redis.count("SET")).toBe(1));

    let secondRan = false;
    const second = withPaymentProcessorLock(
      "verify",
      "payment-1",
      async () => { secondRan = true; return "second"; },
      { redisClient: redis, waitMs: 200, retryMs: 2, ttlMs: 1_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(secondRan).toBe(false);

    releaseFirst("first");
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(redis.keys("lock:payment-processor:")).toHaveLength(0);
  });

  it("returns a bounded 409 conflict when contention outlives the wait budget", async () => {
    const redis = createFakeRedis();
    const key = paymentProcessorLockKey("refund", "payment-1");
    await redis.sendCommand(["SET", key, "other-owner", "PX", "1000", "NX"]);

    await expect(
      withPaymentProcessorLock("refund", "payment-1", vi.fn(), {
        redisClient: redis,
        waitMs: 5,
        retryMs: 1,
        ttlMs: 1_000,
      }),
    ).rejects.toMatchObject({ status: 409, code: "PAYMENT_PROCESSOR_LOCKED" });
  });

  it("never releases a lease now owned by another worker", async () => {
    const redis = createFakeRedis();
    const key = paymentProcessorLockKey("verify", "payment-2");

    await withPaymentProcessorLock("verify", "payment-2", async () => {
      redis.store.set(key, { value: "new-owner", expiresAt: Date.now() + 1_000 });
    }, { redisClient: redis, waitMs: 10, retryMs: 1, ttlMs: 1_000 });

    expect((await redis.sendCommand(["GET", key]))).toBe("new-owner");
  });

  it("renews a long-running owner's lease before it expires", async () => {
    let owner = null;
    let renewals = 0;
    const redis = {
      isOpen: true,
      async sendCommand([command, scriptOrKey, valueOrCount, ...args]) {
        if (command === "SET") {
          if (owner) return null;
          owner = valueOrCount;
          return "OK";
        }
        if (command === "EVAL" && String(scriptOrKey).includes("pexpire")) {
          const token = args[1];
          if (owner !== token) return 0;
          renewals += 1;
          return 1;
        }
        if (command === "EVAL") {
          const token = args[1];
          if (owner !== token) return 0;
          owner = null;
          return 1;
        }
        throw new Error(`unexpected command ${command}`);
      },
    };

    await withPaymentProcessorLock("verify", "payment-renew", async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
    }, { redisClient: redis, ttlMs: 30, waitMs: 10, retryMs: 1 });

    expect(renewals).toBeGreaterThan(0);
    expect(owner).toBeNull();
  });

  it("uses a process-local lock when Redis is unavailable", async () => {
    const unavailable = { isOpen: false };
    let active = 0;
    let peak = 0;
    const work = () => withPaymentProcessorLock("verify", "payment-3", async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    }, { redisClient: unavailable, waitMs: 100, retryMs: 1 });

    await Promise.all([work(), work(), work()]);
    expect(peak).toBe(1);
  });

  it("fails closed when distributed coordination is configured but unavailable", async () => {
    const callback = vi.fn();
    await expect(withPaymentProcessorLock("verify", "payment-required", callback, {
      redisClient: { isOpen: false },
      requireDistributed: true,
    })).rejects.toMatchObject({
      status: 503,
      code: "PAYMENT_PROCESSOR_COORDINATION_UNAVAILABLE",
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("propagates Redis failures and never runs an uncoordinated mutation", async () => {
    const redis = createFakeRedis();
    redis.setFailure(new Error("ECONNREFUSED"));
    const callback = vi.fn();
    await expect(
      withPaymentProcessorLock("verify", "payment-4", callback, { redisClient: redis }),
    ).rejects.toThrow("ECONNREFUSED");
    expect(callback).not.toHaveBeenCalled();
  });
});
