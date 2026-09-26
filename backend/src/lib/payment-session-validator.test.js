import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("./stellar.js", () => ({
  isValidStellarPublicKey: vi.fn(
    (value) => typeof value === "string" && /^G[A-Z2-7]{55}$/.test(value),
  ),
}));

vi.mock("../constants/assetConstants.js", () => ({
  resolveAssetIssuer: vi.fn((_asset, issuer) => issuer || null),
}));

vi.mock("./logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from "./logger.js";
import {
  validatePaymentSession,
  getPaymentSessionValidatorHealth,
  resetPaymentSessionValidatorHealth,
  SessionValidatorHealthMonitor,
} from "./payment-session-validator.js";
import { paymentSessionValidatorRegister } from "./payment-session-validator-metrics.js";

const VALID_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const OTHER_ISSUER = "GA5XIGA5C7FBPTVQ3CWHKNC7D2ZBHB24G3KUJG5WZ6S4EYWSSBFVL45T";

const validBody = () => ({
  amount: 10,
  asset: "USDC",
  asset_issuer: VALID_ISSUER,
  recipient: VALID_ISSUER,
  description: "Order 1",
});

async function metricValue(name, labels = {}) {
  const metric = paymentSessionValidatorRegister.getSingleMetric(name);
  const { values } = await metric.get();
  const match = values.find(
    (v) =>
      !v.metricName?.endsWith("_bucket") &&
      !v.metricName?.endsWith("_sum") &&
      Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  );
  return match ? match.value : 0;
}

describe("validatePaymentSession (issues #1447, #1448)", () => {
  beforeEach(() => {
    paymentSessionValidatorRegister.resetMetrics();
    resetPaymentSessionValidatorHealth();
    vi.clearAllMocks();
  });

  it("accepts a valid payload and returns the sanitized copy + resolved issuer", async () => {
    const result = validatePaymentSession({ body: validBody(), merchant: { id: "m1" }, source: "http" });
    expect(result).toEqual({
      ok: true,
      payload: validBody(),
      asset: "USDC",
      assetIssuer: VALID_ISSUER,
    });
    expect(
      await metricValue("payment_session_validator_evaluations_total", { source: "http", outcome: "accepted" }),
    ).toBe(1);
    expect(
      await metricValue("payment_session_validator_duration_seconds", { source: "http", outcome: "accepted" }),
    ).toBe(1); // _count
  });

  it("uppercases the asset from the sanitized payload", () => {
    const result = validatePaymentSession({
      body: { ...validBody(), asset: " usdc​ " },
      merchant: {},
      source: "service",
    });
    expect(result.ok).toBe(true);
    expect(result.asset).toBe("USDC");
    expect(result.payload.asset).toBe("usdc");
  });

  it.each([
    ["sanitization", "malformed_payload", () => "not-an-object", {}],
    ["sanitization", "forbidden_key", () => JSON.parse(`{"__proto__":{"x":1},"amount":1}`), {}],
    ["sanitization", "field_too_long", () => ({ ...validBody(), client_id: "x".repeat(200) }), {}],
    ["payload", "invalid_asset", () => ({ ...validBody(), asset: "US$C" }), {}],
    ["payload", "invalid_amount", () => ({ ...validBody(), amount: 1.123456789 }), {}],
    ["payload", "invalid_amount", () => ({ ...validBody(), amount: "10" }), {}],
    ["issuer", "missing_issuer", () => ({ ...validBody(), asset_issuer: undefined }), {}],
    ["issuer", "invalid_issuer", () => ({ ...validBody(), asset_issuer: "GNOTVALID" }), {}],
    ["limits", "below_min", () => validBody(), { payment_limits: { USDC: { min: 50 } } }],
    ["limits", "above_max", () => validBody(), { payment_limits: { USDC: { max: 5 } } }],
    ["allowlist", "issuer_not_allowed", () => validBody(), { allowed_issuers: [OTHER_ISSUER] }],
  ])("rejects at rule=%s reason=%s and records it", async (rule, reason, makeBody, merchant) => {
    const result = validatePaymentSession({ body: makeBody(), merchant: { id: "m1", ...merchant }, source: "http" });
    expect(result.ok).toBe(false);
    expect(result.rejection.rule).toBe(rule);
    expect(result.rejection.reason).toBe(reason);
    expect(typeof result.rejection.message).toBe("string");
    expect(
      await metricValue("payment_session_validator_rejections_total", { source: "http", rule, reason }),
    ).toBe(1);
    expect(
      await metricValue("payment_session_validator_evaluations_total", { source: "http", outcome: "rejected" }),
    ).toBe(1);
    expect(logger.info).toHaveBeenCalledWith(
      { merchantId: "m1", source: "http", rule, reason },
      "Payment session rejected by validator",
    );
  });

  it("evaluates rules in order: sanitization before payload before issuer before limits", () => {
    const merchant = { payment_limits: { USDC: { max: 1 } }, allowed_issuers: [OTHER_ISSUER] };
    const result = validatePaymentSession({
      body: { ...validBody(), asset_issuer: "bad", amount: 0.123456789 },
      merchant,
    });
    expect(result.rejection.rule).toBe("payload");
    const next = validatePaymentSession({ body: { ...validBody(), asset_issuer: "bad" }, merchant });
    expect(next.rejection.rule).toBe("issuer");
  });

  it("passes limit details through on limit rejections", () => {
    const result = validatePaymentSession({
      body: validBody(),
      merchant: { payment_limits: { USDC: { max: 4 } } },
    });
    expect(result.rejection.details).toEqual({ max: 4, delta: 6 });
  });

  it("never logs the raw payload", () => {
    validatePaymentSession({
      body: { ...validBody(), description: "secret‮", asset: "!!" },
      merchant: { id: "m1" },
      source: "http",
    });
    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain(VALID_ISSUER);
  });

  it("counts sanitized fields and suspicious signals", async () => {
    validatePaymentSession({
      body: { ...validBody(), description: "hi‮", client_id: "c\u0000" },
      merchant: { id: "m1" },
      source: "http",
    });
    expect(await metricValue("payment_session_validator_sanitized_fields_total", { field: "description" })).toBe(1);
    expect(await metricValue("payment_session_validator_sanitized_fields_total", { field: "client_id" })).toBe(1);
    expect(await metricValue("payment_session_validator_suspicious_payloads_total", { signal: "bidi_control" })).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { merchantId: "m1", source: "http", signals: ["bidi_control"] },
      "Suspicious payment session payload",
    );
  });

  it("records merchant config anomalies without blocking the session", async () => {
    const result = validatePaymentSession({
      body: validBody(),
      merchant: { id: "m1", payment_limits: { USDC: { min: "abc", max: 5 } } },
      source: "service",
    });
    expect(result.rejection?.reason).toBe("above_max"); // valid max still enforced
    expect(await metricValue("payment_session_validator_config_anomalies_total", { kind: "invalid_min" })).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ anomalies: ["invalid_min"] }),
      expect.stringContaining("misconfigured"),
    );
  });

  it("collapses unknown sources into a single label to bound cardinality", async () => {
    validatePaymentSession({ body: validBody(), merchant: {}, source: "attacker-controlled-" + Math.random() });
    expect(
      await metricValue("payment_session_validator_evaluations_total", { source: "unknown", outcome: "accepted" }),
    ).toBe(1);
  });

  it("records internal errors, logs them and rethrows", async () => {
    // Force an unexpected failure mid-validation via a throwing getter.
    const merchant = {
      id: "m1",
      get allowed_issuers() {
        throw new Error("db row corrupted");
      },
    };
    expect(() => validatePaymentSession({ body: validBody(), merchant, source: "http" })).toThrow(
      "db row corrupted",
    );
    expect(
      await metricValue("payment_session_validator_evaluations_total", { source: "http", outcome: "error" }),
    ).toBe(1);
    expect(logger.error).toHaveBeenCalled();
    expect(getPaymentSessionValidatorHealth().errors).toBe(1);
  });

  it("refreshes health gauges at scrape time", async () => {
    for (let i = 0; i < 25; i++) {
      validatePaymentSession({ body: { ...validBody(), asset: "!" }, merchant: {} });
    }
    const text = await paymentSessionValidatorRegister.metrics();
    expect(text).toMatch(/payment_session_validator_health_state\{[^}]*\} 1/);
    expect(text).toMatch(/payment_session_validator_rejection_ratio\{[^}]*\} 1/);
    expect(text).toContain("payment_session_validator_last_evaluation_timestamp_seconds");
  });
});

describe("SessionValidatorHealthMonitor (issue #1448)", () => {
  let clock;
  const make = (opts = {}) =>
    new SessionValidatorHealthMonitor(
      {
        windowMs: 60_000,
        bucketMs: 1_000,
        minSamples: 10,
        errorRatioThreshold: 0.1,
        rejectionRatioThreshold: 0.5,
        suspiciousThreshold: 3,
        ...opts,
      },
      () => clock,
    );

  beforeEach(() => {
    clock = 1_700_000_000_000;
  });

  it("is healthy with no traffic", () => {
    const snap = make().snapshot();
    expect(snap).toMatchObject({ status: "healthy", total: 0, rejection_ratio: 0, last_evaluation_at: null });
  });

  it("does not alarm below the minimum sample size", () => {
    const m = make();
    for (let i = 0; i < 9; i++) m.record("error");
    expect(m.snapshot().status).toBe("healthy");
  });

  it("goes unhealthy when the error ratio crosses the threshold", () => {
    const m = make();
    for (let i = 0; i < 9; i++) m.record("accepted");
    m.record("error");
    m.record("error");
    const snap = m.snapshot();
    expect(snap.status).toBe("unhealthy");
    expect(snap.reasons).toContain("error_ratio_exceeded");
  });

  it("goes degraded on a high rejection ratio or a suspicious spike", () => {
    const m = make();
    for (let i = 0; i < 10; i++) m.record("rejected");
    expect(m.snapshot()).toMatchObject({ status: "degraded", reasons: ["rejection_ratio_exceeded"] });

    const s = make();
    for (let i = 0; i < 3; i++) s.record("rejected", { suspicious: true });
    expect(s.snapshot()).toMatchObject({ status: "degraded", reasons: ["suspicious_payload_spike"] });
  });

  it("unhealthy takes precedence but all reasons are reported", () => {
    const m = make();
    for (let i = 0; i < 10; i++) m.record("error", { suspicious: true });
    const snap = m.snapshot();
    expect(snap.status).toBe("unhealthy");
    expect(snap.reasons).toEqual(["error_ratio_exceeded", "suspicious_payload_spike"]);
  });

  it("forgets events that fall out of the rolling window", () => {
    const m = make();
    for (let i = 0; i < 20; i++) m.record("error");
    expect(m.snapshot().status).toBe("unhealthy");
    clock += 61_000;
    const snap = m.snapshot();
    expect(snap.total).toBe(0);
    expect(snap.status).toBe("healthy");
    expect(snap.last_evaluation_at).not.toBeNull();
  });

  it("reuses bucket slots without leaking old counts", () => {
    const m = make({ windowMs: 3_000 });
    m.record("error");
    clock += 3_000; // same ring index, new slot
    m.record("accepted");
    expect(m.snapshot()).toMatchObject({ total: 1, accepted: 1, errors: 0 });
  });

  it("keeps memory constant under heavy load", () => {
    const m = make();
    for (let i = 0; i < 100_000; i++) {
      clock += 7;
      m.record(i % 2 ? "accepted" : "rejected");
    }
    expect(m.buckets).toHaveLength(60);
    expect(m.snapshot().total).toBeLessThanOrEqual(60_000 / 7 + 1);
  });
});

describe("alert rules (issue #1448)", () => {
  it("only reference metrics that the validator registry exposes", () => {
    const rules = readFileSync(
      new URL("../../docs/alerts/payment-session-validator.rules.yml", import.meta.url),
      "utf8",
    );
    const referenced = new Set(
      [...rules.matchAll(/\b(payment_session_validator_[a-z_]+)/g)].map(([, name]) =>
        name.replace(/_(bucket|sum|count)$/, ""),
      ),
    );
    const registered = new Set(
      paymentSessionValidatorRegister.getMetricsAsArray().map((m) => m.name),
    );
    expect(referenced.size).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(registered, `alert rule references unknown metric ${name}`).toContain(name);
    }
  });
});
