import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  persistVerificationWithRecovery,
  recoverMerchantDlq,
  scheduleMerchantRecovery,
  merchantDlq,
  resetMerchantRecoveryForTests,
  VERIFICATION_METADATA_KEY,
} from "./merchant-recovery.js";
import {
  merchantLifecycleRegister,
  resetMerchantLifecycleMetrics,
} from "./merchant-lifecycle-metrics.js";

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const noSleep = async () => {};
const VERIFICATION = {
  status: "verified",
  domain: "shop.example.com",
  verification_token: "tok_public_challenge",
  checked_at: "2026-01-01T00:00:00Z",
};

function pgError(code, message = `pg ${code}`) {
  return Object.assign(new Error(message), { code });
}

/** Supabase double where update() results come from a queue. */
function makeSupabase({ updateResults = [], row = { metadata: { other: 1 } }, readError = null } = {}) {
  const updates = [];
  const queue = [...updateResults];
  const from = vi.fn(() => ({
    update(patch) {
      updates.push(patch);
      return {
        eq: vi.fn(async () => (queue.length ? queue.shift() : { error: null })),
      };
    },
    select() {
      return {
        eq: () => ({ maybeSingle: async () => ({ data: row, error: readError }) }),
      };
    },
  }));
  return { client: { from }, updates };
}

async function metric(name, labels = {}) {
  const m = await merchantLifecycleRegister.getSingleMetric(name).get();
  const hit = m.values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val));
  return hit ? hit.value : 0;
}

function persist(client, extra = {}) {
  return persistVerificationWithRecovery(
    client,
    { merchantId: "m-1", metadata: { [VERIFICATION_METADATA_KEY]: VERIFICATION }, verification: VERIFICATION },
    { sleep: noSleep, random: () => 0, logger: silentLogger, scheduleRecovery: false, ...extra },
  );
}

describe("persistVerificationWithRecovery", () => {
  beforeEach(() => {
    resetMerchantRecoveryForTests();
    resetMerchantLifecycleMetrics();
    vi.clearAllMocks();
  });

  it("persists on the first attempt", async () => {
    const { client, updates } = makeSupabase();

    expect(await persist(client)).toEqual({ persisted: true });
    expect(updates).toHaveLength(1);
    expect(merchantDlq.size).toBe(0);
  });

  it("retries a transient failure and then persists", async () => {
    const { client, updates } = makeSupabase({
      updateResults: [{ error: pgError("08006") }, { error: { message: "x", status: 503 } }, { error: null }],
    });

    expect(await persist(client)).toEqual({ persisted: true });
    expect(updates).toHaveLength(3);
    expect(await metric("merchant_lifecycle_persist_retries_total")).toBe(2);
  });

  it("dead-letters the result when transient failures persist", async () => {
    const down = { error: pgError("08006", "connection failure") };
    const { client } = makeSupabase({ updateResults: [down, down, down] });

    expect(await persist(client)).toEqual({ persisted: false, queued: true });
    expect(merchantDlq.size).toBe(1);
    expect(merchantDlq.has("verification:m-1")).toBe(true);
    expect(await metric("merchant_lifecycle_dlq_operations_total", { action: "push", status: "success" })).toBe(1);
  });

  it("does not retry or dead-letter a non-transient error", async () => {
    const constraint = pgError("23505", "duplicate");
    const { client, updates } = makeSupabase({ updateResults: [{ error: constraint }] });

    await expect(persist(client)).rejects.toMatchObject({ status: 500, code: "23505" });
    expect(updates).toHaveLength(1);
    expect(merchantDlq.size).toBe(0);
  });

  it("coalesces repeated failures for one merchant", async () => {
    const down = { error: pgError("08006") };
    const { client } = makeSupabase({ updateResults: [down, down, down, down, down, down] });
    await persist(client);
    await persist(client);
    expect(merchantDlq.size).toBe(1);
  });

  it("never queues credentials", async () => {
    const down = { error: pgError("08006") };
    const { client } = makeSupabase({ updateResults: [down, down, down] });
    await persist(client);

    const entry = merchantDlq._entries.get("verification:m-1");
    expect(Object.keys(entry.payload).sort()).toEqual(["merchantId", "verification"]);
    expect(JSON.stringify(entry)).not.toMatch(/api_key|webhook_secret|password|sk_|whsec_/);
  });
});

describe("recoverMerchantDlq", () => {
  beforeEach(() => {
    resetMerchantRecoveryForTests();
    resetMerchantLifecycleMetrics();
    vi.clearAllMocks();
  });

  async function deadLetter() {
    const down = { error: pgError("08006") };
    await persist(makeSupabase({ updateResults: [down, down, down] }).client);
    merchantDlq._entries.get("verification:m-1").nextRetryAt = 0;
  }

  it("requires a supabase client", async () => {
    await expect(recoverMerchantDlq({})).rejects.toThrow(TypeError);
  });

  it("merges only the verification key into the current metadata", async () => {
    await deadLetter();
    const { client, updates } = makeSupabase({ row: { metadata: { other: 1, theme: "dark" } } });

    const result = await recoverMerchantDlq({ supabase: client });

    expect(result).toMatchObject({ recovered: 1, failed: 0, exhausted: 0 });
    expect(updates).toEqual([
      { metadata: { other: 1, theme: "dark", [VERIFICATION_METADATA_KEY]: VERIFICATION } },
    ]);
    expect(merchantDlq.size).toBe(0);
  });

  it("handles a merchant with no metadata yet", async () => {
    await deadLetter();
    const { client, updates } = makeSupabase({ row: { metadata: null } });

    await recoverMerchantDlq({ supabase: client });

    expect(updates[0]).toEqual({ metadata: { [VERIFICATION_METADATA_KEY]: VERIFICATION } });
  });

  it("isolates the entry at once when the merchant no longer exists", async () => {
    await deadLetter();
    const { client } = makeSupabase({ row: null });

    const result = await recoverMerchantDlq({ supabase: client });

    expect(result.exhausted).toBe(1);
    expect(merchantDlq.stats()).toEqual({ total: 1, pending: 0, exhausted: 1 });
  });

  it("isolates the entry at once on a non-transient write error", async () => {
    await deadLetter();
    const { client } = makeSupabase({ updateResults: [{ error: pgError("23514", "check violation") }] });

    const result = await recoverMerchantDlq({ supabase: client });

    expect(result.exhausted).toBe(1);
  });

  it("backs off on a transient failure and keeps the entry", async () => {
    await deadLetter();
    const { client } = makeSupabase({ updateResults: [{ error: pgError("08006") }] });

    const result = await recoverMerchantDlq({ supabase: client });

    expect(result).toMatchObject({ failed: 1, exhausted: 0 });
    expect(merchantDlq.size).toBe(1);
    expect(merchantDlq.list()[0].attempts).toBe(1);
  });

  it("surfaces a read failure as a retryable failure", async () => {
    await deadLetter();
    const { client } = makeSupabase({ readError: pgError("08006") });

    const result = await recoverMerchantDlq({ supabase: client });

    expect(result.failed).toBe(1);
    expect(merchantDlq.size).toBe(1);
  });

  it("throttles background recovery to one run per window", async () => {
    vi.useFakeTimers();
    try {
      await deadLetter();
      const { client } = makeSupabase();
      let now = 5_000_000;

      expect(scheduleMerchantRecovery({ supabase: client, now: () => now, logger: silentLogger })).toBe(true);
      expect(scheduleMerchantRecovery({ supabase: client, now: () => now + 500, logger: silentLogger })).toBe(false);
      await vi.runAllTimersAsync();
      expect(merchantDlq.size).toBe(0);

      now += 20_000;
      expect(scheduleMerchantRecovery({ supabase: client, now: () => now, logger: silentLogger })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
