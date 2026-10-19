import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../lib/db.js", () => {
  const client = {
    query: vi.fn(async (sql) => {
      if (String(sql).trim().toUpperCase().startsWith("SELECT")) {
        return { rows: [{ ok: 1 }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client) }, __client: client };
});

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as db from "../lib/db.js";
const { pool } = db;
const client = db.__client;
import { withMerchantContext, validateAndSanitizeMerchantId } from "../lib/db-rls.js";
import {
  DatabaseRlsHealthMonitor,
  recordRlsTransaction,
  getDatabaseRowLevelSecurityHealth,
  resetDatabaseRowLevelSecurityTelemetry,
  dbRlsTransactionsTotal,
  dbRlsTransactionDuration,
  dbRlsActiveTransactions,
  dbRlsRegister,
  HEALTH_STATE_VALUES,
} from "../lib/db-rls-telemetry.js";

async function counterValue(outcome) {
  const metric = dbRlsRegister.getSingleMetric("database_rls_transactions_total");
  const { values } = await metric.get();
  return values.find((v) => v.labels.outcome === outcome)?.value ?? 0;
}

async function gaugeValue(name) {
  const metric = dbRlsRegister.getSingleMetric(name);
  const { values } = await metric.get();
  return values[0]?.value ?? 0;
}

function bucketStart(now, bucketMs = 5_000) {
  return Math.floor(now / bucketMs) * bucketMs;
}

describe("DatabaseRlsHealthMonitor", () => {
  let now;
  let monitor;

  beforeEach(() => {
    now = Date.now();
    monitor = new DatabaseRlsHealthMonitor(
      { windowMs: 60_000, bucketMs: 5_000, minSamples: 10, errorRatioThreshold: 0.05, rollbackRatioThreshold: 0.5, invalidInputThreshold: 5 },
      () => now,
    );
  });

  it("reports healthy with no traffic and zero ratios", () => {
    const snap = monitor.snapshot();
    expect(snap.status).toBe("healthy");
    expect(snap.total).toBe(0);
    expect(snap.error_ratio).toBe(0);
    expect(snap.rollback_ratio).toBe(0);
    expect(snap.last_transaction_at).toBeNull();
  });

  it("is healthy when all transactions commit", () => {
    for (let i = 0; i < 20; i++) monitor.record("committed");
    const snap = monitor.snapshot();
    expect(snap.status).toBe("healthy");
    expect(snap.total).toBe(20);
    expect(snap.committed).toBe(20);
    expect(snap.errors).toBe(0);
  });

  it("goes unhealthy when error ratio exceeds threshold with enough samples", () => {
    for (let i = 0; i < 18; i++) monitor.record("committed");
    for (let i = 0; i < 2; i++) monitor.record("connection_error");
    const snap = monitor.snapshot();
    expect(snap.status).toBe("unhealthy");
    expect(snap.reasons).toContain("error_ratio_exceeded");
    expect(snap.errors).toBe(2);
    expect(snap.error_ratio).toBeCloseTo(0.1, 4);
  });

  it("stays healthy on a tiny sample below minSamples", () => {
    monitor.record("connection_error");
    const snap = monitor.snapshot();
    expect(snap.status).toBe("healthy");
    expect(snap.errors).toBe(1);
  });

  it("goes degraded on a high rollback ratio", () => {
    for (let i = 0; i < 12; i++) monitor.record("rolled_back");
    for (let i = 0; i < 8; i++) monitor.record("committed");
    const snap = monitor.snapshot();
    expect(snap.status).toBe("degraded");
    expect(snap.reasons).toContain("rollback_ratio_exceeded");
  });

  it("goes degraded on an invalid-input spike", () => {
    for (let i = 0; i < 5; i++) monitor.record("invalid_input");
    const snap = monitor.snapshot();
    expect(snap.status).toBe("degraded");
    expect(snap.reasons).toContain("invalid_input_spike");
  });

  it("expires counts outside the rolling window", () => {
    for (let i = 0; i < 20; i++) monitor.record("connection_error", now - 120_000);
    for (let i = 0; i < 5; i++) monitor.record("committed");
    const snap = monitor.snapshot();
    expect(snap.connection_error).toBe(0);
    expect(snap.committed).toBe(5);
    expect(snap.status).toBe("healthy");
  });

  it("records the last transaction timestamp", () => {
    monitor.record("committed");
    expect(monitor.snapshot().last_transaction_at).not.toBeNull();
  });
});

describe("recordRlsTransaction", () => {
  beforeEach(() => resetDatabaseRowLevelSecurityTelemetry());
  afterEach(() => resetDatabaseRowLevelSecurityTelemetry());

  it("increments counters and observes duration per outcome", async () => {
    recordRlsTransaction("committed", 0.01);
    recordRlsTransaction("committed", 0.02);
    recordRlsTransaction("rolled_back", 0.03);
    expect(await counterValue("committed")).toBe(2);
    expect(await counterValue("rolled_back")).toBe(1);
    const duration = await dbRlsTransactionDuration.get();
    const observations = duration.values
      .filter((v) => v.metricName === "database_rls_transaction_duration_seconds_count")
      .reduce((sum, v) => sum + v.value, 0);
    expect(observations).toBe(3);
    expect(await gaugeValue("database_rls_active_transactions")).toBe(0);
  });

  it("falls back to transaction_error for unknown outcomes", async () => {
    recordRlsTransaction("mystery", 0.01);
    expect(await counterValue("transaction_error")).toBe(1);
    expect(await counterValue("mystery")).toBe(0);
  });

  it("drives the rolling health snapshot", async () => {
    for (let i = 0; i < 18; i++) recordRlsTransaction("committed", 0.01);
    for (let i = 0; i < 2; i++) recordRlsTransaction("transaction_error", 0.01);
    const health = getDatabaseRowLevelSecurityHealth();
    expect(health.status).toBe("unhealthy");
    expect(health.transaction_error).toBe(2);
  });
});

describe("withMerchantContext telemetry", () => {
  beforeEach(() => {
    resetDatabaseRowLevelSecurityTelemetry();
    vi.clearAllMocks();
  });
  afterEach(() => resetDatabaseRowLevelSecurityTelemetry());

  it("records committed outcome and active gauge returns to zero", async () => {
    await withMerchantContext("merch_1", async (c) => {
      expect(await gaugeValue("database_rls_active_transactions")).toBe(1);
      await c.query("SELECT 1");
      return "ok";
    });
    expect(await counterValue("committed")).toBe(1);
    expect(await gaugeValue("database_rls_active_transactions")).toBe(0);
  });

  it("records rolled_back outcome when the callback throws", async () => {
    await expect(
      withMerchantContext("merch_1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await counterValue("rolled_back")).toBe(1);
    expect(await gaugeValue("database_rls_active_transactions")).toBe(0);
    expect(client.release).toHaveBeenCalled();
  });

  it("records invalid_input for a bad merchant id without touching the pool", async () => {
    await expect(withMerchantContext("bad id!", () => {})).rejects.toThrow(/Invalid merchantId/);
    expect(await counterValue("invalid_input")).toBe(1);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("records invalid_input for a non-function callback", async () => {
    await expect(withMerchantContext("merch_1", "nope")).rejects.toThrow(/callback must be a function/);
    expect(await counterValue("invalid_input")).toBe(1);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("records connection_error when the pool cannot provide a client", async () => {
    pool.connect.mockRejectedValueOnce(new Error("pool exhausted"));
    await expect(withMerchantContext("merch_1", async () => "ok")).rejects.toThrow("pool exhausted");
    expect(await counterValue("connection_error")).toBe(1);
    expect(await gaugeValue("database_rls_active_transactions")).toBe(0);
  });

  it("records transaction_error when BEGIN fails", async () => {
    client.query.mockImplementationOnce(async () => {
      throw new Error("begin failed");
    });
    await expect(withMerchantContext("merch_1", async () => "ok")).rejects.toThrow("begin failed");
    expect(await counterValue("transaction_error")).toBe(1);
    expect(await gaugeValue("database_rls_active_transactions")).toBe(0);
  });
});

describe("validation still enforced", () => {
  it("rejects oversized and malformed ids", () => {
    expect(validateAndSanitizeMerchantId("x".repeat(200)).valid).toBe(false);
    expect(validateAndSanitizeMerchantId("bad;drop").valid).toBe(false);
    expect(validateAndSanitizeMerchantId("merch_1").valid).toBe(true);
  });
});
