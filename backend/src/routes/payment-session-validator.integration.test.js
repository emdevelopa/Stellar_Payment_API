/**
 * Integration & stress suite for the Payment Session Validator (issue #1451).
 *
 * Exercises the REAL session pipeline end-to-end over HTTP:
 *
 *   idempotencyMiddleware → createSession → withPaymentSessionLock
 *     → payment-session-rules (issuer / limits / allowlist)
 *     → insertPaymentSessionWithRetry → 201 / 4xx / 5xx
 *
 * Only true process boundaries are faked: Supabase (an in-memory "payments"
 * table with injectable faults) and Redis (tests/helpers/fake-redis.js, shared
 * between app instances to model multiple API nodes).
 */
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    redis: null,
    db: null,
  },
}));

vi.mock("../lib/redis.js", () => ({
  connectRedisClient: vi.fn(async () => state.redis),
  getRedisClient: vi.fn(() => state.redis),
  getCachedPayment: vi.fn(),
  setCachedPayment: vi.fn(),
  invalidatePaymentCache: vi.fn(),
}));

vi.mock("../lib/supabase-client.js", () => ({
  getSupabaseClient: vi.fn(async () => state.db.client),
}));

vi.mock("../lib/supabase.js", () => ({
  supabase: { from: vi.fn(() => state.db.client.from("payments")) },
}));

vi.mock("../lib/stellar.js", () => ({
  findMatchingPayment: vi.fn(),
  findAnyRecentPayment: vi.fn(),
  findStrictReceivePaths: vi.fn(),
  getNetworkFeeStats: vi.fn(),
  isValidStellarPublicKey: vi.fn(
    (value) => typeof value === "string" && /^G[A-Z2-7]{55}$/.test(value),
  ),
  validateMemo: vi.fn(() => ({ valid: true })),
  verifyTransactionSignature: vi.fn(),
}));

vi.mock("../constants/assetConstants.js", async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAssetIssuer: vi.fn((_asset, issuer) => issuer || null),
}));

vi.mock("../lib/create-payment-rate-limit.js", () => ({
  createCreatePaymentRateLimit: () => (_req, _res, next) => next(),
}));
vi.mock("../lib/rate-limit.js", () => ({
  createVerifyPaymentRateLimit: () => (_req, _res, next) => next(),
}));
vi.mock("../lib/recaptcha.js", () => ({
  recaptchaMiddleware: () => (_req, _res, next) => next(),
}));
// Request-shape validation is covered by request-schemas tests; here we
// target the business-rule validator, so bypass the Zod layer.
vi.mock("../lib/validation.js", () => ({
  validateRequest: () => (_req, _res, next) => next(),
}));
vi.mock("../lib/sanitize-metadata.js", () => ({
  sanitizeMetadataMiddleware: (_req, _res, next) => next(),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/webhooks.js", () => ({
  sendWebhook: vi.fn(),
  isEventSubscribed: vi.fn(() => false),
}));
vi.mock("../lib/email.js", () => ({ sendReceiptEmail: vi.fn() }));
vi.mock("../lib/email-templates.js", () => ({ renderReceiptEmail: vi.fn(() => "") }));
vi.mock("../webhooks/resolver.js", () => ({ getPayloadForVersion: vi.fn(() => ({})) }));
vi.mock("../lib/stream-manager.js", () => ({
  streamManager: { notify: vi.fn(), addClient: vi.fn() },
}));
vi.mock("../lib/metrics.js", () => ({
  paymentCreatedCounter: { inc: vi.fn() },
  paymentConfirmedCounter: { inc: vi.fn() },
  paymentConfirmationLatency: { observe: vi.fn() },
  paymentFailedCounter: { inc: vi.fn() },
  exchangeRateQuoteRequests: { inc: vi.fn() },
  exchangeRateQuoteDuration: { observe: vi.fn() },
  exchangeRateSlippageApplied: { inc: vi.fn() },
}));
vi.mock("../services/paymentService.js", () => ({ paymentService: {} }));

import createPaymentsRouter from "./payments.js";
import { idempotencyMiddleware } from "../lib/idempotency.js";
import { resetLocalSessionLocksForTests } from "../lib/payment-session-lock.js";
import { createFakeRedis } from "../../tests/helpers/fake-redis.js";

const VALID_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const OTHER_ISSUER = "GA5XIGA5C7FBPTVQ3CWHKNC7D2ZBHB24G3KUJG5WZ6S4EYWSSBFVL45T";
const RECIPIENT = "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6";

/**
 * In-memory "payments" table. `faults` is a queue of results consumed by
 * successive insert calls: "transient" | "outage" | "constraint" |
 * "lost-ack" (row IS written but the client sees a timeout).
 */
function createFakeDb({ latencyMs = 0 } = {}) {
  const rows = new Map();
  const faults = [];
  const stats = { insertCalls: 0, inFlight: 0, maxInFlight: 0 };
  let randomFaultRate = 0;

  const tick = () =>
    latencyMs > 0
      ? new Promise((r) => setTimeout(r, Math.random() * latencyMs))
      : Promise.resolve();

  async function insert(row) {
    stats.insertCalls += 1;
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      return await doInsert(row);
    } finally {
      stats.inFlight -= 1;
    }
  }

  async function doInsert(row) {
    await tick();
    let fault = faults.shift();
    if (!fault && randomFaultRate > 0 && Math.random() < randomFaultRate) {
      fault = Math.random() < 0.5 ? "transient" : "lost-ack";
    }
    switch (fault) {
      case "transient":
        return { error: { message: "TypeError: fetch failed", code: "" } };
      case "outage":
        return { error: { message: "Service Unavailable", status: 503 } };
      case "constraint":
        return { error: { message: "violates check constraint", code: "23514" } };
      case "lost-ack":
        if (!rows.has(row.id)) rows.set(row.id, structuredClone(row));
        return { error: { message: "timeout", code: "ETIMEDOUT" } };
      default:
        break;
    }
    if (rows.has(row.id)) {
      return { error: { message: "duplicate key value", code: "23505" } };
    }
    rows.set(row.id, structuredClone(row));
    return { error: null };
  }

  return {
    rows,
    faults,
    stats,
    setRandomFaultRate(rate) {
      randomFaultRate = rate;
    },
    client: { from: () => ({ insert }) },
  };
}

const defaultMerchant = {
  id: "merchant-1",
  payment_limits: { USDC: { min: 1, max: 1000 } },
  allowed_issuers: [VALID_ISSUER],
  branding_config: null,
};

const openServers = [];

/**
 * One "API node", listening on its own ephemeral port. Several nodes can
 * share state.redis / state.db. A long-lived server per node (rather than
 * supertest's server-per-request) keeps the stress tests about the code
 * under test, not about socket churn in the test harness.
 */
async function buildApp() {
  const server = createAppInstance().listen(0, "127.0.0.1");
  openServers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
}

function createAppInstance() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.merchant = {
      ...defaultMerchant,
      id: req.get("x-test-merchant") || defaultMerchant.id,
    };
    next();
  });
  app.use("/api/sessions", idempotencyMiddleware);
  app.use("/api/create-payment", idempotencyMiddleware);
  app.use("/api", createPaymentsRouter());
  return app;
}

/** Locks are released in `finally`, right after the response is flushed. */
async function expectLocksDrained() {
  await vi.waitFor(() => expect(state.redis.keys("lock:")).toEqual([]), { timeout: 5000 });
}

function sessionBody(overrides = {}) {
  return {
    amount: 25,
    asset: "USDC",
    asset_issuer: VALID_ISSUER,
    recipient: RECIPIENT,
    ...overrides,
  };
}

beforeAll(() => {
  process.env.PAYMENT_SESSION_RETRY_BASE_DELAY_MS = "1";
  process.env.PAYMENT_SESSION_RETRY_MAX_DELAY_MS = "5";
  process.env.PAYMENT_SESSION_RETRY_MAX_ATTEMPTS = "3";
});

afterAll(() => {
  delete process.env.PAYMENT_SESSION_RETRY_BASE_DELAY_MS;
  delete process.env.PAYMENT_SESSION_RETRY_MAX_DELAY_MS;
  delete process.env.PAYMENT_SESSION_RETRY_MAX_ATTEMPTS;
});

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  resetLocalSessionLocksForTests();
  state.redis = createFakeRedis();
  state.db = createFakeDb();
});

// ---------------------------------------------------------------------------
// Validation rules over HTTP
// ---------------------------------------------------------------------------

describe("Payment Session Validator — business rules (integration)", () => {
  it("creates a session for a valid request and persists exactly one row", async () => {
    const res = await request(await buildApp()).post("/api/sessions").send(sessionBody());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "pending", sandbox: false });
    expect(res.body.payment_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.db.rows.size).toBe(1);
    const row = state.db.rows.get(res.body.payment_id);
    expect(row).toMatchObject({
      merchant_id: "merchant-1",
      asset: "USDC",
      asset_issuer: VALID_ISSUER,
      amount: 25,
      status: "pending",
    });
  });

  it("accepts native XLM without an issuer", async () => {
    const res = await request(await buildApp())
      .post("/api/sessions")
      .send(sessionBody({ asset: "XLM", asset_issuer: undefined, amount: 5 }));
    expect(res.status).toBe(201);
  });

  it.each([
    [
      "missing issuer for non-native asset",
      { asset_issuer: undefined },
      "asset_issuer is required for non-native assets",
    ],
    [
      "malformed issuer",
      { asset_issuer: "not-a-stellar-key" },
      "asset_issuer must be a valid Stellar public key",
    ],
    [
      "issuer outside the merchant allowlist",
      { asset_issuer: OTHER_ISSUER },
      "asset_issuer is not in the merchant's list of allowed issuers",
    ],
    ["amount below the per-asset minimum", { amount: 0.5 }, "Amount is below the minimum for USDC"],
    ["amount above the per-asset maximum", { amount: 5000 }, "Amount exceeds the maximum for USDC"],
  ])("rejects %s with 400 and never touches the database", async (_label, overrides, message) => {
    const res = await request(await buildApp()).post("/api/sessions").send(sessionBody(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
    expect(state.db.stats.insertCalls).toBe(0);
  });

  it("returns limit deltas for below-minimum rejections", async () => {
    const res = await request(await buildApp()).post("/api/sessions").send(sessionBody({ amount: 0.25 }));
    expect(res.body).toMatchObject({ min: 1, delta: 0.75 });
  });

  it("applies identical rules on /create-payment", async () => {
    const app = await buildApp();
    const ok = await request(app).post("/api/create-payment").send(sessionBody());
    const bad = await request(app)
      .post("/api/create-payment")
      .send(sessionBody({ asset_issuer: OTHER_ISSUER }));
    expect(ok.status).toBe(201);
    expect(bad.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Retry with exponential backoff (issue #1449)
// ---------------------------------------------------------------------------

describe("Payment Session Validator — retry & backoff (integration)", () => {
  it("recovers from transient persistence failures", async () => {
    state.db.faults.push("transient", "outage");
    const res = await request(await buildApp()).post("/api/sessions").send(sessionBody());
    expect(res.status).toBe(201);
    expect(state.db.stats.insertCalls).toBe(3);
    expect(state.db.rows.size).toBe(1);
  });

  it("does not create a duplicate when an insert committed but its ack was lost", async () => {
    state.db.faults.push("lost-ack");
    const res = await request(await buildApp()).post("/api/sessions").send(sessionBody());
    expect(res.status).toBe(201);
    expect(state.db.stats.insertCalls).toBe(2);
    expect(state.db.rows.size).toBe(1);
    expect(state.db.rows.has(res.body.payment_id)).toBe(true);
  });

  it("returns 500 after exhausting retries on a sustained outage", async () => {
    state.db.faults.push("outage", "outage", "outage", "outage");
    const res = await request(await buildApp()).post("/api/sessions").send(sessionBody());
    expect(res.status).toBe(500);
    expect(state.db.stats.insertCalls).toBe(3);
    expect(state.db.rows.size).toBe(0);
  });

  it("fails fast (no retry) on constraint violations", async () => {
    state.db.faults.push("constraint");
    const res = await request(await buildApp()).post("/api/sessions").send(sessionBody());
    expect(res.status).toBe(500);
    expect(state.db.stats.insertCalls).toBe(1);
  });

  it("does not cache failed responses under the Idempotency-Key", async () => {
    state.db.faults.push("outage", "outage", "outage");
    const app = await buildApp();
    const failed = await request(app)
      .post("/api/sessions")
      .set("Idempotency-Key", "retry-after-500")
      .send(sessionBody());
    expect(failed.status).toBe(500);

    const retried = await request(app)
      .post("/api/sessions")
      .set("Idempotency-Key", "retry-after-500")
      .send(sessionBody());
    expect(retried.status).toBe(201);
    expect(state.db.rows.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Distributed concurrency control (issue #1450)
// ---------------------------------------------------------------------------

describe("Payment Session Validator — concurrency control (integration)", () => {
  it("creates exactly ONE session for a burst of identical Idempotency-Key requests", async () => {
    state.redis = createFakeRedis({ latencyMs: 3 });
    state.db = createFakeDb({ latencyMs: 10 });
    const app = await buildApp();

    const responses = await Promise.all(
      Array.from({ length: 25 }, () =>
        request(app).post("/api/sessions").set("Idempotency-Key", "burst-1").send(sessionBody()),
      ),
    );

    const created = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);
    expect(created.length + conflicts.length).toBe(25);
    expect(state.db.rows.size).toBe(1);
    expect(state.db.stats.maxInFlight).toBe(1);

    // Every 201 (original or replay) must reference the same session.
    const ids = new Set(created.map((r) => r.body.payment_id));
    expect(ids.size).toBe(1);
    for (const c of conflicts) {
      expect(c.body.code).toBe("PAYMENT_SESSION_IN_PROGRESS");
    }
  });

  it("serializes across multiple API nodes sharing Redis", async () => {
    state.redis = createFakeRedis({ latencyMs: 3 });
    state.db = createFakeDb({ latencyMs: 10 });
    const nodes = [await buildApp(), await buildApp(), await buildApp()];

    const responses = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        request(nodes[i % nodes.length])
          .post("/api/sessions")
          .set("Idempotency-Key", "multi-node")
          .send(sessionBody()),
      ),
    );

    expect(state.db.rows.size).toBe(1);
    expect(responses.every((r) => r.status === 201 || r.status === 409)).toBe(true);
  });

  it("replays the original response after the in-flight request completes", async () => {
    const app = await buildApp();
    const first = await request(app)
      .post("/api/sessions")
      .set("Idempotency-Key", "replay-1")
      .send(sessionBody());
    const second = await request(app)
      .post("/api/sessions")
      .set("Idempotency-Key", "replay-1")
      .send(sessionBody());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.payment_id).toBe(first.body.payment_id);
    expect(state.db.rows.size).toBe(1);
  });

  it("replays inside the lock when a twin passed the middleware before the cache was written", async () => {
    // Model the race precisely: request B has already passed the idempotency
    // middleware (cache miss) when A commits. B must replay, not re-create.
    state.db = createFakeDb({ latencyMs: 25 });
    const app = await buildApp();
    const a = request(app).post("/api/sessions").set("Idempotency-Key", "race").send(sessionBody());
    const b = new Promise((resolve) => setTimeout(resolve, 5)).then(() =>
      request(app).post("/api/sessions").set("Idempotency-Key", "race").send(sessionBody()),
    );
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra.status).toBe(201);
    expect([201, 409]).toContain(rb.status);
    expect(state.db.rows.size).toBe(1);
  });

  it("rejects reuse of an Idempotency-Key with a different payload", async () => {
    const app = await buildApp();
    await request(app).post("/api/sessions").set("Idempotency-Key", "k-mismatch").send(sessionBody());
    const res = await request(app)
      .post("/api/sessions")
      .set("Idempotency-Key", "k-mismatch")
      .send(sessionBody({ amount: 999 }));
    expect(res.status).toBe(400);
    expect(state.db.rows.size).toBe(1);
  });

  it("does not let one merchant's Idempotency-Key block another merchant", async () => {
    state.db = createFakeDb({ latencyMs: 10 });
    const app = await buildApp();
    const [m1, m2] = await Promise.all([
      request(app)
        .post("/api/sessions")
        .set("x-test-merchant", "merchant-A")
        .set("Idempotency-Key", "shared")
        .send(sessionBody()),
      request(app)
        .post("/api/sessions")
        .set("x-test-merchant", "merchant-B")
        .set("Idempotency-Key", "shared")
        .send(sessionBody()),
    ]);
    expect(m1.status).toBe(201);
    expect(m2.status).toBe(201);
    expect(m1.body.payment_id).not.toBe(m2.body.payment_id);
    expect(state.db.rows.size).toBe(2);
  });

  it("does NOT serialize requests without an Idempotency-Key", async () => {
    state.db = createFakeDb({ latencyMs: 5 });
    const app = await buildApp();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => request(app).post("/api/sessions").send(sessionBody())),
    );
    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(state.db.rows.size).toBe(10);
    await expectLocksDrained();
  });

  it("releases the lock after validation failures so the client can correct and retry", async () => {
    const app = await buildApp();
    const bad = await request(app)
      .post("/api/sessions")
      .set("Idempotency-Key", "fix-and-retry")
      .send(sessionBody({ amount: 99999 }));
    expect(bad.status).toBe(400);
    await expectLocksDrained();
  });

  it("still enforces mutual exclusion when Redis is down (local fallback)", async () => {
    // Degraded mode: without Redis there is no idempotency cache to replay
    // from, so the guarantee is "never two in-flight creations for the same
    // key" — overlapping twins get 409 instead of racing into the database.
    state.redis = { isOpen: false, get: async () => null, set: async () => "OK" };
    state.db = createFakeDb({ latencyMs: 40 });
    const app = await buildApp();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).post("/api/sessions").set("Idempotency-Key", "no-redis").send(sessionBody()),
      ),
    );
    expect(responses.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(responses.some((r) => r.status === 409)).toBe(true);
    expect(state.db.stats.maxInFlight).toBe(1);
    expect(state.db.rows.size).toBe(responses.filter((r) => r.status === 201).length);
  });

  it("hashes hostile Idempotency-Keys instead of embedding them in Redis keys", async () => {
    const hostile = "x".repeat(2000) + ":lock:payment-session:merchant-2:*";
    const res = await request(await buildApp())
      .post("/api/sessions")
      .set("Idempotency-Key", hostile)
      .send(sessionBody());
    expect(res.status).toBe(201);
    const lockCommands = state.redis.commandLog.filter(
      ([cmd, key]) => cmd === "SET" && String(key).startsWith("lock:"),
    );
    expect(lockCommands).toHaveLength(1);
    expect(lockCommands[0][1]).toMatch(/^lock:payment-session:merchant-1:[a-f0-9]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Stress
// ---------------------------------------------------------------------------

describe("Payment Session Validator — stress", { timeout: 30_000 }, () => {
  it("handles 200 concurrent distinct sessions under a 30% fault rate without loss or duplication", async () => {
    state.redis = createFakeRedis({ latencyMs: 2 });
    state.db = createFakeDb({ latencyMs: 4 });
    state.db.setRandomFaultRate(0.3);
    process.env.PAYMENT_SESSION_RETRY_MAX_ATTEMPTS = "6";
    const nodes = [await buildApp(), await buildApp(), await buildApp(), await buildApp()];

    try {
      const started = Date.now();
      const responses = await Promise.all(
        Array.from({ length: 200 }, (_, i) =>
          request(nodes[i % nodes.length])
            .post("/api/sessions")
            .set("Idempotency-Key", `stress-${i}`)
            .send(sessionBody({ amount: 1 + (i % 900) })),
        ),
      );
      const elapsed = Date.now() - started;

      const statuses = responses.map((r) => r.status);
      const created = responses.filter((r) => r.status === 201);
      // 0.3^6 ≈ 0.07% per request, so essentially all must succeed.
      expect(created.length).toBeGreaterThanOrEqual(198);
      expect(statuses.every((s) => s === 201 || s === 500)).toBe(true);

      const ids = new Set(created.map((r) => r.body.payment_id));
      expect(ids.size).toBe(created.length);
      for (const id of ids) {
        expect(state.db.rows.has(id)).toBe(true);
      }
      // Every persisted row belongs to a request (no orphans beyond lost-acks
      // of requests that ultimately failed).
      expect(state.db.rows.size).toBeLessThanOrEqual(200);
      expect(state.db.rows.size).toBeGreaterThanOrEqual(created.length);
      // All locks released (release runs just after the response flushes).
      await expectLocksDrained();
      // Bounded latency: backoff is capped, so the whole burst stays fast.
      expect(elapsed).toBeLessThan(10_000);
    } finally {
      process.env.PAYMENT_SESSION_RETRY_MAX_ATTEMPTS = "3";
    }
  });

  it("keeps exactly-once semantics for 20 keys × 10 concurrent duplicates each", async () => {
    state.redis = createFakeRedis({ latencyMs: 2 });
    state.db = createFakeDb({ latencyMs: 5 });
    const nodes = [await buildApp(), await buildApp()];

    const responses = await Promise.all(
      Array.from({ length: 200 }, (_, i) => {
        const key = `dup-${i % 20}`;
        return request(nodes[i % 2])
          .post("/api/sessions")
          .set("Idempotency-Key", key)
          .send(sessionBody())
          .then((res) => ({ key, res }));
      }),
    );

    expect(state.db.rows.size).toBe(20);
    const byKey = new Map();
    for (const { key, res } of responses) {
      expect([201, 409]).toContain(res.status);
      if (res.status === 201) {
        const ids = byKey.get(key) ?? new Set();
        ids.add(res.body.payment_id);
        byKey.set(key, ids);
      }
    }
    expect(byKey.size).toBe(20);
    for (const ids of byKey.values()) {
      expect(ids.size).toBe(1);
    }
    await expectLocksDrained();
  });

  it("rejects a flood of invalid sessions without a single database write", async () => {
    const app = await buildApp();
    const responses = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        request(app)
          .post("/api/sessions")
          .send(
            sessionBody(
              [
                { asset_issuer: undefined },
                { asset_issuer: "bad" },
                { asset_issuer: OTHER_ISSUER },
                { amount: 0.1 },
                { amount: 10_000 },
              ][i % 5],
            ),
          ),
      ),
    );
    expect(responses.every((r) => r.status === 400)).toBe(true);
    expect(state.db.stats.insertCalls).toBe(0);
  });
});
