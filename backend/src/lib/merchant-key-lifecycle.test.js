import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildMerchantLockKey,
  withMerchantLock,
  compareAndSwapMerchant,
  createLifecycleBusyError,
  MERCHANT_LIFECYCLE_BUSY,
  MERCHANT_CREDENTIAL_CONFLICT,
} from "./merchant-key-lifecycle.js";
import { resetLocalSessionLocksForTests } from "./payment-session-lock.js";
import {
  merchantLifecycleRegister,
  resetMerchantLifecycleMetrics,
} from "./merchant-lifecycle-metrics.js";

// A no-op Redis client forces the in-process lock, which is what we can test deterministically.
const noRedis = async () => ({ isOpen: false });

async function metric(name, labels = {}) {
  const m = await merchantLifecycleRegister.getSingleMetric(name).get();
  const hit = m.values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val));
  return hit ? hit.value : 0;
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Minimal chainable supabase double for the CAS update. */
function supabaseReturning(result) {
  const calls = { eq: [], is: [], update: null };
  const builder = {
    update(patch) {
      calls.update = patch;
      return builder;
    },
    eq(col, val) {
      calls.eq.push([col, val]);
      return builder;
    },
    is(col, val) {
      calls.is.push([col, val]);
      return builder;
    },
    select: vi.fn(async () => result),
  };
  return { client: { from: vi.fn(() => builder) }, calls, builder };
}

describe("buildMerchantLockKey", () => {
  it("scopes key locks by merchant id", () => {
    expect(buildMerchantLockKey("key", "m-1")).toBe("lock:merchant:key:m-1");
  });

  it("hashes and lowercases the email for registration locks", () => {
    const a = buildMerchantLockKey("register", "Alice@Example.com");
    const b = buildMerchantLockKey("register", " alice@example.com ");
    expect(a).toBe(b);
    expect(a).toMatch(/^lock:merchant:register:[0-9a-f]{64}$/);
    expect(a).not.toContain("alice");
  });

  it("rejects bad input", () => {
    expect(() => buildMerchantLockKey("nope", "x")).toThrow(TypeError);
    expect(() => buildMerchantLockKey("key", "")).toThrow(TypeError);
    expect(() => buildMerchantLockKey("key", 5)).toThrow(TypeError);
  });
});

describe("withMerchantLock", () => {
  beforeEach(() => {
    resetLocalSessionLocksForTests();
    resetMerchantLifecycleMetrics();
  });

  it("runs the function and returns its result", async () => {
    const result = await withMerchantLock(
      { scope: "key", id: "m-1", operation: "rotate_key" },
      async () => "done",
      { getRedis: noRedis },
    );
    expect(result).toBe("done");
    expect(await metric("merchant_lifecycle_lock_total", { operation: "rotate_key", outcome: "acquired" })).toBe(1);
  });

  it("rejects a concurrent operation for the same merchant with 409", async () => {
    const gate = deferred();
    const first = withMerchantLock(
      { scope: "key", id: "m-1", operation: "rotate_key" },
      () => gate.promise,
      { getRedis: noRedis },
    );

    await expect(
      withMerchantLock({ scope: "key", id: "m-1", operation: "rotate_webhook_secret" }, async () => "x", {
        getRedis: noRedis,
      }),
    ).rejects.toMatchObject({ status: 409, code: MERCHANT_LIFECYCLE_BUSY });

    gate.resolve("ok");
    await first;
    expect(
      await metric("merchant_lifecycle_lock_total", { operation: "rotate_webhook_secret", outcome: "contended" }),
    ).toBe(1);
  });

  it("allows different merchants to run in parallel", async () => {
    const gate = deferred();
    const first = withMerchantLock({ scope: "key", id: "m-1", operation: "rotate_key" }, () => gate.promise, {
      getRedis: noRedis,
    });
    const other = await withMerchantLock({ scope: "key", id: "m-2", operation: "rotate_key" }, async () => "ok", {
      getRedis: noRedis,
    });
    expect(other).toBe("ok");
    gate.resolve();
    await first;
  });

  it("keeps registration and key locks independent", async () => {
    const gate = deferred();
    const reg = withMerchantLock({ scope: "register", id: "a@b.co", operation: "register" }, () => gate.promise, {
      getRedis: noRedis,
    });
    const key = await withMerchantLock({ scope: "key", id: "a@b.co", operation: "rotate_key" }, async () => 1, {
      getRedis: noRedis,
    });
    expect(key).toBe(1);
    gate.resolve();
    await reg;
  });

  it("releases the lock after success so the next request proceeds", async () => {
    const scope = { scope: "key", id: "m-1", operation: "rotate_key" };
    await withMerchantLock(scope, async () => 1, { getRedis: noRedis });
    await expect(withMerchantLock(scope, async () => 2, { getRedis: noRedis })).resolves.toBe(2);
  });

  it("releases the lock when the function throws", async () => {
    const scope = { scope: "key", id: "m-1", operation: "rotate_key" };
    await expect(
      withMerchantLock(
        scope,
        async () => {
          throw new Error("db down");
        },
        { getRedis: noRedis },
      ),
    ).rejects.toThrow("db down");
    await expect(withMerchantLock(scope, async () => "ok", { getRedis: noRedis })).resolves.toBe("ok");
  });

  it("serializes N concurrent callers so exactly one wins", async () => {
    const gate = deferred();
    let entered = 0;
    const attempts = Array.from({ length: 5 }, () =>
      withMerchantLock(
        { scope: "key", id: "m-1", operation: "rotate_key" },
        async () => {
          entered += 1;
          await gate.promise;
        },
        { getRedis: noRedis },
      ).then(
        () => "won",
        (err) => err.code,
      ),
    );
    await new Promise((r) => setTimeout(r, 10));
    gate.resolve();
    const outcomes = await Promise.all(attempts);

    expect(entered).toBe(1);
    expect(outcomes.filter((o) => o === "won")).toHaveLength(1);
    expect(outcomes.filter((o) => o === MERCHANT_LIFECYCLE_BUSY)).toHaveLength(4);
  });

  it("builds a retry-safe busy error", () => {
    const err = createLifecycleBusyError("rotate_key");
    expect(err.status).toBe(409);
    expect(err.retryable).toBe(false);
    expect(err.message).not.toMatch(/sk_|whsec_/);
  });
});

describe("compareAndSwapMerchant", () => {
  beforeEach(() => resetMerchantLifecycleMetrics());

  it("updates only when the stored credential still matches", async () => {
    const { client, calls } = supabaseReturning({ data: [{ id: "m-1" }], error: null });

    const row = await compareAndSwapMerchant(
      client,
      "m-1",
      { column: "api_key", value: "sk_old" },
      { api_key: "sk_new" },
      "rotate_key",
    );

    expect(row).toEqual({ id: "m-1" });
    expect(calls.update).toEqual({ api_key: "sk_new" });
    expect(calls.eq).toEqual([
      ["id", "m-1"],
      ["api_key", "sk_old"],
    ]);
  });

  it("matches a missing credential with IS NULL", async () => {
    const { client, calls } = supabaseReturning({ data: [{ id: "m-1" }], error: null });
    await compareAndSwapMerchant(client, "m-1", { column: "api_key", value: null }, { api_key: "sk_new" });
    expect(calls.is).toEqual([["api_key", null]]);
    expect(calls.eq).toEqual([["id", "m-1"]]);
  });

  it("throws 409 when no row matched (stale credential or deleted merchant)", async () => {
    const { client } = supabaseReturning({ data: [], error: null });

    await expect(
      compareAndSwapMerchant(client, "m-1", { column: "api_key", value: "sk_old" }, { api_key: "sk_new" }, "rotate_key"),
    ).rejects.toMatchObject({ status: 409, code: MERCHANT_CREDENTIAL_CONFLICT });
    expect(await metric("merchant_credential_conflicts_total", { operation: "rotate_key" })).toBe(1);
  });

  it("treats a null data result as a conflict", async () => {
    const { client } = supabaseReturning({ data: null, error: null });
    await expect(
      compareAndSwapMerchant(client, "m-1", { column: "api_key", value: "x" }, {}),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("propagates database errors as 500", async () => {
    const dbError = new Error("connection lost");
    const { client } = supabaseReturning({ data: null, error: dbError });

    await expect(
      compareAndSwapMerchant(client, "m-1", { column: "api_key", value: "x" }, {}),
    ).rejects.toMatchObject({ status: 500, message: "connection lost" });
  });

  it("never puts credentials in the conflict error", async () => {
    const { client } = supabaseReturning({ data: [], error: null });
    const err = await compareAndSwapMerchant(
      client,
      "m-1",
      { column: "api_key", value: "sk_supersecret" },
      { api_key: "sk_newsecret" },
    ).catch((e) => e);
    expect(JSON.stringify({ message: err.message, code: err.code })).not.toMatch(/supersecret|newsecret/);
  });
});
