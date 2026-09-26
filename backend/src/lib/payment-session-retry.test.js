import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from "./logger.js";
import {
  DEFAULT_RETRY_OPTIONS,
  UNIQUE_VIOLATION,
  computeBackoffDelay,
  insertPaymentSessionWithRetry,
  isRetryableSessionError,
  resolveRetryOptions,
  withSessionRetry,
} from "./payment-session-retry.js";

const noSleep = vi.fn(async () => {});

function errWith(props) {
  return Object.assign(new Error(props.message ?? "boom"), props);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isRetryableSessionError (issue #1449)", () => {
  it.each([
    ["HTTP 500", { status: 500 }],
    ["HTTP 502", { status: 502 }],
    ["HTTP 503", { status: 503 }],
    ["HTTP 504", { statusCode: 504 }],
    ["HTTP 429", { status: 429 }],
    ["HTTP 408", { status: 408 }],
    ["axios-style 503", { response: { status: 503 } }],
    ["ECONNRESET", { code: "ECONNRESET" }],
    ["ETIMEDOUT", { code: "ETIMEDOUT" }],
    ["EAI_AGAIN", { code: "EAI_AGAIN" }],
    ["undici socket", { code: "UND_ERR_SOCKET" }],
    ["pg connection failure 08006", { code: "08006" }],
    ["pg serialization failure", { code: "40001" }],
    ["pg deadlock", { code: "40P01" }],
    ["pg too many connections", { code: "53300" }],
    ["pg admin shutdown", { code: "57P01" }],
    ["supabase fetch failed", { message: "TypeError: fetch failed", code: "" }],
    ["socket hang up", { message: "socket hang up" }],
    ["explicit retryable flag", { retryable: true, status: 400 }],
  ])("retries %s", (_label, props) => {
    expect(isRetryableSessionError(errWith(props))).toBe(true);
  });

  it.each([
    ["HTTP 400 validation", { status: 400 }],
    ["HTTP 401", { status: 401 }],
    ["HTTP 403", { status: 403 }],
    ["HTTP 404", { status: 404 }],
    ["HTTP 409", { status: 409 }],
    ["HTTP 422", { status: 422 }],
    ["HTTP 501 not implemented", { status: 501 }],
    ["pg unique violation", { code: UNIQUE_VIOLATION }],
    ["pg check violation", { code: "23514" }],
    ["pg undefined column", { code: "42703" }],
    ["opt-out flag beats 503", { retryable: false, status: 503 }],
    ["plain error", { message: "something unexpected" }],
  ])("does NOT retry %s", (_label, props) => {
    expect(isRetryableSessionError(errWith(props))).toBe(false);
  });

  it("does not retry non-object throwables", () => {
    expect(isRetryableSessionError(null)).toBe(false);
    expect(isRetryableSessionError(undefined)).toBe(false);
    expect(isRetryableSessionError("ECONNRESET")).toBe(false);
  });
});

describe("resolveRetryOptions", () => {
  it("uses defaults when nothing is configured", () => {
    expect(resolveRetryOptions({}, {})).toEqual({ ...DEFAULT_RETRY_OPTIONS });
  });

  it("reads env overrides", () => {
    expect(
      resolveRetryOptions(
        {},
        {
          PAYMENT_SESSION_RETRY_MAX_ATTEMPTS: "5",
          PAYMENT_SESSION_RETRY_BASE_DELAY_MS: "50",
          PAYMENT_SESSION_RETRY_MAX_DELAY_MS: "500",
        },
      ),
    ).toEqual({ maxAttempts: 5, baseDelayMs: 50, maxDelayMs: 500 });
  });

  it("clamps hostile or nonsensical values to safe bounds", () => {
    const opts = resolveRetryOptions(
      { maxAttempts: 10_000, baseDelayMs: -5, maxDelayMs: 9e9 },
      {},
    );
    expect(opts.maxAttempts).toBe(6);
    expect(opts.baseDelayMs).toBe(0);
    expect(opts.maxDelayMs).toBe(10_000);
  });

  it("never lets maxDelay fall below baseDelay and forces at least one attempt", () => {
    const opts = resolveRetryOptions({ maxAttempts: 0, baseDelayMs: 400, maxDelayMs: 10 }, {});
    expect(opts.maxAttempts).toBe(1);
    expect(opts.maxDelayMs).toBe(400);
  });

  it("falls back to defaults for non-numeric input", () => {
    expect(resolveRetryOptions({ maxAttempts: "abc" }, {}).maxAttempts).toBe(3);
  });
});

describe("computeBackoffDelay", () => {
  const opts = { baseDelayMs: 100, maxDelayMs: 1000 };

  it("grows the ceiling exponentially", () => {
    const max = () => 0.999999;
    expect(computeBackoffDelay(0, opts, max)).toBe(99);
    expect(computeBackoffDelay(1, opts, max)).toBe(199);
    expect(computeBackoffDelay(2, opts, max)).toBe(399);
    expect(computeBackoffDelay(3, opts, max)).toBe(799);
  });

  it("caps at maxDelayMs", () => {
    expect(computeBackoffDelay(10, opts, () => 0.999999)).toBe(999);
  });

  it("applies full jitter (can be zero)", () => {
    expect(computeBackoffDelay(3, opts, () => 0)).toBe(0);
  });

  it("always stays within [0, ceiling] for random inputs", () => {
    for (let i = 0; i < 500; i += 1) {
      const retry = i % 8;
      const d = computeBackoffDelay(retry, opts);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(Math.min(1000, 100 * 2 ** retry));
    }
  });
});

describe("withSessionRetry", () => {
  it("returns immediately on success without sleeping", async () => {
    const op = vi.fn().mockResolvedValue("ok");
    await expect(withSessionRetry(op, { sleep: noSleep })).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
    expect(op).toHaveBeenCalledWith({ attempt: 1 });
    expect(noSleep).not.toHaveBeenCalled();
  });

  it("retries transient failures and succeeds", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(errWith({ code: "ECONNRESET" }))
      .mockRejectedValueOnce(errWith({ status: 503 }))
      .mockResolvedValue("ok");
    const onRetry = vi.fn();

    await expect(
      withSessionRetry(op, { sleep: noSleep, random: () => 0.5, maxAttempts: 3, onRetry }),
    ).resolves.toBe("ok");

    expect(op).toHaveBeenCalledTimes(3);
    expect(op.mock.calls.map(([ctx]) => ctx.attempt)).toEqual([1, 2, 3]);
    expect(noSleep).toHaveBeenCalledTimes(2);
    // base 100 → ceilings 100, 200; random 0.5 → 50, 100
    expect(noSleep.mock.calls.map(([ms]) => ms)).toEqual([50, 100]);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("does not retry deterministic failures and annotates the error", async () => {
    const validation = errWith({ status: 400, message: "bad input" });
    const op = vi.fn().mockRejectedValue(validation);

    await expect(withSessionRetry(op, { sleep: noSleep })).rejects.toBe(validation);
    expect(op).toHaveBeenCalledTimes(1);
    expect(validation.retryAttempts).toBe(1);
    expect(noSleep).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("rethrows the LAST error after exhausting attempts and logs it", async () => {
    const first = errWith({ status: 503, message: "first" });
    const last = errWith({ status: 503, message: "last" });
    const op = vi
      .fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(last);

    await expect(withSessionRetry(op, { sleep: noSleep, maxAttempts: 3 })).rejects.toBe(last);
    expect(op).toHaveBeenCalledTimes(3);
    expect(last.retryAttempts).toBe(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("honours a custom shouldRetry predicate", async () => {
    const op = vi.fn().mockRejectedValue(errWith({ status: 503 }));
    await expect(
      withSessionRetry(op, { sleep: noSleep, shouldRetry: () => false }),
    ).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("includes context fields in retry logs without leaking payload data", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(errWith({ status: 503 }))
      .mockResolvedValue("ok");
    await withSessionRetry(op, {
      sleep: noSleep,
      label: "unit",
      context: { paymentId: "p-1" },
    });
    const [fields] = logger.warn.mock.calls[0];
    expect(fields).toMatchObject({ label: "unit", paymentId: "p-1", attempt: 1, status: 503 });
  });
});

describe("insertPaymentSessionWithRetry", () => {
  function supabaseWith(insertImpl) {
    const insert = vi.fn(insertImpl);
    return { insert, client: { from: vi.fn(() => ({ insert })) } };
  }
  const payload = { id: "pay-1", merchant_id: "m-1", amount: 10 };

  it("inserts once when the first attempt succeeds", async () => {
    const { insert, client } = supabaseWith(async () => ({ error: null }));
    await expect(
      insertPaymentSessionWithRetry(client, payload, { sleep: noSleep }),
    ).resolves.toEqual({ error: null, recoveredDuplicate: false });
    expect(client.from).toHaveBeenCalledWith("payments");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(payload);
  });

  it("retries Supabase transport errors returned in { error }", async () => {
    const { insert, client } = supabaseWith(
      vi
        .fn()
        .mockResolvedValueOnce({ error: { message: "TypeError: fetch failed", code: "" } })
        .mockResolvedValueOnce({ error: { message: "upstream", status: 503 } })
        .mockResolvedValue({ error: null }),
    );
    const res = await insertPaymentSessionWithRetry(client, payload, { sleep: noSleep });
    expect(res.recoveredDuplicate).toBe(false);
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it("treats a duplicate key on a RETRY as already persisted (lost ack)", async () => {
    const { insert, client } = supabaseWith(
      vi
        .fn()
        .mockResolvedValueOnce({ error: { message: "timeout", code: "ETIMEDOUT" } })
        .mockResolvedValueOnce({ error: { message: "dup", code: UNIQUE_VIOLATION } }),
    );
    const res = await insertPaymentSessionWithRetry(client, payload, { sleep: noSleep });
    expect(res).toEqual({ error: null, recoveredDuplicate: true });
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("surfaces a duplicate key on the FIRST attempt (real conflict, not retried)", async () => {
    const dup = { message: "dup", code: UNIQUE_VIOLATION };
    const { insert, client } = supabaseWith(async () => ({ error: dup }));
    await expect(
      insertPaymentSessionWithRetry(client, payload, { sleep: noSleep }),
    ).rejects.toBe(dup);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("does not retry constraint/validation errors", async () => {
    const check = { message: "violates check constraint", code: "23514" };
    const { insert, client } = supabaseWith(async () => ({ error: check }));
    await expect(
      insertPaymentSessionWithRetry(client, payload, { sleep: noSleep }),
    ).rejects.toBe(check);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts on a persistent outage", async () => {
    const down = { message: "Service Unavailable", status: 503 };
    const { insert, client } = supabaseWith(async () => ({ error: down }));
    await expect(
      insertPaymentSessionWithRetry(client, payload, { sleep: noSleep, maxAttempts: 4 }),
    ).rejects.toBe(down);
    expect(insert).toHaveBeenCalledTimes(4);
    expect(down.retryAttempts).toBe(4);
  });

  it("retries thrown (not returned) network exceptions", async () => {
    const { insert, client } = supabaseWith(
      vi
        .fn()
        .mockRejectedValueOnce(errWith({ code: "ECONNREFUSED" }))
        .mockResolvedValue({ error: null }),
    );
    await insertPaymentSessionWithRetry(client, payload, { sleep: noSleep });
    expect(insert).toHaveBeenCalledTimes(2);
  });
});
