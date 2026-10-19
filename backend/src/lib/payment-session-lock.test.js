import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./redis.js", () => ({
  connectRedisClient: vi.fn(async () => ({ isOpen: false })),
}));

import { logger } from "./logger.js";
import { createFakeRedis } from "../../tests/helpers/fake-redis.js";
import {
  DEFAULT_LOCK_TTL_MS,
  PAYMENT_SESSION_IN_PROGRESS,
  RELEASE_LOCK_SCRIPT,
  acquireSessionLock,
  buildSessionLockKey,
  resetLocalSessionLocksForTests,
  resolveLockTtlMs,
  withPaymentSessionLock,
} from "./payment-session-lock.js";

beforeEach(() => {
  vi.clearAllMocks();
  resetLocalSessionLocksForTests();
});

describe("buildSessionLockKey (issue #1450)", () => {
  it("namespaces by merchant and hashes the idempotency key", () => {
    const key = buildSessionLockKey("merchant-1", "order-42");
    expect(key).toMatch(/^lock:payment-session:merchant-1:[a-f0-9]{64}$/);
    expect(key).not.toContain("order-42");
  });

  it("is deterministic", () => {
    expect(buildSessionLockKey("m", "k")).toBe(buildSessionLockKey("m", "k"));
  });

  it("isolates merchants using the same idempotency key", () => {
    expect(buildSessionLockKey("m1", "k")).not.toBe(buildSessionLockKey("m2", "k"));
  });

  it("neutralises key-injection attempts and bounds key size", () => {
    const hostile = "x:*:lock:payment-session:other-merchant\r\n" + "A".repeat(100_000);
    const key = buildSessionLockKey("m1", hostile);
    expect(key.length).toBeLessThan(120);
    expect(key).not.toMatch(/[\r\n*]/);
    expect(key.startsWith("lock:payment-session:m1:")).toBe(true);
  });

  it("rejects missing inputs", () => {
    expect(() => buildSessionLockKey("", "k")).toThrow(TypeError);
    expect(() => buildSessionLockKey("m", "")).toThrow(TypeError);
    expect(() => buildSessionLockKey("m", null)).toThrow(TypeError);
  });
});

describe("resolveLockTtlMs", () => {
  it("defaults to 30s", () => {
    expect(resolveLockTtlMs(undefined, {})).toBe(DEFAULT_LOCK_TTL_MS);
  });
  it("reads env and clamps to [1s, 120s]", () => {
    expect(resolveLockTtlMs(undefined, { PAYMENT_SESSION_LOCK_TTL_MS: "5000" })).toBe(5000);
    expect(resolveLockTtlMs(10, {})).toBe(1000);
    expect(resolveLockTtlMs(10_000_000, {})).toBe(120_000);
    expect(resolveLockTtlMs("nope", {})).toBe(DEFAULT_LOCK_TTL_MS);
  });
});

describe("acquireSessionLock — Redis backend", () => {
  it("acquires with SET NX PX and a unique token", async () => {
    const redis = createFakeRedis();
    const lock = await acquireSessionLock("k1", { getRedis: async () => redis, ttlMs: 5000 });
    expect(lock).toMatchObject({ key: "k1", backend: "redis", ttlMs: 5000 });
    expect(lock.token).toMatch(/[0-9a-f-]{36}/);
    expect(redis.store.get("k1").value).toBe(lock.token);
  });

  it("refuses a second holder while the lock is live", async () => {
    const redis = createFakeRedis();
    const getRedis = async () => redis;
    const first = await acquireSessionLock("k1", { getRedis });
    const second = await acquireSessionLock("k1", { getRedis });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("releases via compare-and-delete", async () => {
    const redis = createFakeRedis();
    const send = vi.spyOn(redis, "sendCommand");
    const lock = await acquireSessionLock("k1", { getRedis: async () => redis });
    await expect(lock.release()).resolves.toBe(true);
    expect(redis.store.has("k1")).toBe(false);
    expect(send).toHaveBeenLastCalledWith(["EVAL", RELEASE_LOCK_SCRIPT, "1", "k1", lock.token]);
  });

  it("never deletes a lock that expired and was re-acquired by someone else", async () => {
    const redis = createFakeRedis();
    const getRedis = async () => redis;
    const stale = await acquireSessionLock("k1", { getRedis, ttlMs: 1000 });
    // Simulate expiry, then another request acquiring the key.
    redis.store.delete("k1");
    const fresh = await acquireSessionLock("k1", { getRedis });

    await expect(stale.release()).resolves.toBe(false);
    expect(redis.store.get("k1").value).toBe(fresh.token);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: "k1" }),
      expect.stringMatching(/expired before release/),
    );
  });

  it("lets the lock expire naturally via PX", async () => {
    vi.useFakeTimers();
    try {
      const redis = createFakeRedis();
      const getRedis = async () => redis;
      await acquireSessionLock("k1", { getRedis, ttlMs: 1000 });
      expect(await acquireSessionLock("k1", { getRedis })).toBeNull();
      vi.advanceTimersByTime(1001);
      expect(await acquireSessionLock("k1", { getRedis })).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a failed release as non-fatal", async () => {
    const redis = createFakeRedis();
    const lock = await acquireSessionLock("k1", { getRedis: async () => redis });
    redis.sendCommand = vi.fn().mockRejectedValue(new Error("conn lost"));
    await expect(lock.release()).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("acquireSessionLock — local fallback", () => {
  it("uses the local lock when Redis is the no-op client (isOpen:false)", async () => {
    const lock = await acquireSessionLock("k1", { getRedis: async () => ({ isOpen: false }) });
    expect(lock.backend).toBe("local");
    // No-op Redis would say "OK" to everyone; local lock must still exclude.
    expect(await acquireSessionLock("k1", { getRedis: async () => ({ isOpen: false }) })).toBeNull();
  });

  it("uses the local lock when connecting to Redis throws", async () => {
    const lock = await acquireSessionLock("k1", {
      getRedis: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(lock.backend).toBe("local");
  });

  it("uses the local lock when SET NX itself errors", async () => {
    const redis = createFakeRedis();
    redis.sendCommand = vi.fn().mockRejectedValue(new Error("READONLY"));
    const lock = await acquireSessionLock("k1", { getRedis: async () => redis });
    expect(lock.backend).toBe("local");
  });

  it("uses the default connectRedisClient when none is injected", async () => {
    const lock = await acquireSessionLock("k-default");
    expect(lock.backend).toBe("local");
  });

  it("releases only the owner's local lock", async () => {
    const getRedis = async () => null;
    const lock = await acquireSessionLock("k1", { getRedis });
    await expect(lock.release()).resolves.toBe(true);
    await expect(lock.release()).resolves.toBe(false);
    expect(await acquireSessionLock("k1", { getRedis })).not.toBeNull();
  });

  it("expires local locks after the TTL", async () => {
    vi.useFakeTimers();
    try {
      const getRedis = async () => null;
      await acquireSessionLock("k1", { getRedis, ttlMs: 1000 });
      expect(await acquireSessionLock("k1", { getRedis })).toBeNull();
      vi.advanceTimersByTime(1001);
      expect(await acquireSessionLock("k1", { getRedis })).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withPaymentSessionLock", () => {
  it("runs without locking when there is no Idempotency-Key", async () => {
    const getRedis = vi.fn();
    const fn = vi.fn().mockResolvedValue("done");
    await expect(
      withPaymentSessionLock({ merchantId: "m1", idempotencyKey: null }, fn, { getRedis }),
    ).resolves.toBe("done");
    expect(fn).toHaveBeenCalledWith(null);
    expect(getRedis).not.toHaveBeenCalled();
  });

  it("runs without locking when there is no merchant", async () => {
    const fn = vi.fn().mockResolvedValue("done");
    await withPaymentSessionLock({ idempotencyKey: "k" }, fn);
    expect(fn).toHaveBeenCalledWith(null);
  });

  it("holds the lock during fn and releases it afterwards", async () => {
    const redis = createFakeRedis();
    const getRedis = async () => redis;
    let heldDuring = false;
    await withPaymentSessionLock(
      { merchantId: "m1", idempotencyKey: "k" },
      async (lock) => {
        heldDuring = redis.store.has(lock.key);
      },
      { getRedis },
    );
    expect(heldDuring).toBe(true);
    expect(redis.keys("lock:")).toEqual([]);
  });

  it("releases the lock even when fn throws", async () => {
    const redis = createFakeRedis();
    const boom = new Error("handler failed");
    await expect(
      withPaymentSessionLock(
        { merchantId: "m1", idempotencyKey: "k" },
        async () => {
          throw boom;
        },
        { getRedis: async () => redis },
      ),
    ).rejects.toBe(boom);
    expect(redis.keys("lock:")).toEqual([]);
  });

  it("rejects a concurrent twin with a 409 PAYMENT_SESSION_IN_PROGRESS error", async () => {
    const redis = createFakeRedis();
    const getRedis = async () => redis;
    let releaseFirst;
    const first = withPaymentSessionLock(
      { merchantId: "m1", idempotencyKey: "k" },
      () => new Promise((resolve) => (releaseFirst = resolve)),
      { getRedis },
    );
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf("function"));

    const twin = withPaymentSessionLock(
      { merchantId: "m1", idempotencyKey: "k" },
      vi.fn(),
      { getRedis },
    );
    await expect(twin).rejects.toMatchObject({
      status: 409,
      code: PAYMENT_SESSION_IN_PROGRESS,
      retryable: false,
    });

    releaseFirst("ok");
    await expect(first).resolves.toBe("ok");
  });
});
