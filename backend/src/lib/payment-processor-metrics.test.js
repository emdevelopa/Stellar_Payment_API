import { describe, it, expect, beforeEach } from "vitest";
import {
  paymentProcessorSessionsTotal,
  paymentProcessorSessionDuration,
  paymentProcessorVerificationsTotal,
  paymentProcessorVerificationDuration,
  paymentProcessorStatusCacheHits,
  paymentProcessorStatusCacheMisses,
  paymentProcessorRefundsTotal,
  paymentProcessorListRequestsTotal,
  paymentProcessorRegister,
} from "./payment-processor-metrics.js";

async function metricText() {
  return paymentProcessorRegister.metrics();
}

describe("payment-processor-metrics (issue #1088)", () => {
  beforeEach(async () => {
    paymentProcessorSessionsTotal.reset();
    paymentProcessorSessionDuration.reset();
    paymentProcessorVerificationsTotal.reset();
    paymentProcessorVerificationDuration.reset();
    paymentProcessorStatusCacheHits.reset();
    paymentProcessorStatusCacheMisses.reset();
    paymentProcessorRefundsTotal.reset();
    paymentProcessorListRequestsTotal.reset();
  });

  it("registers every granular series on its own registry", async () => {
    const text = await metricText();
    for (const name of [
      "payment_processor_sessions_total",
      "payment_processor_session_duration_seconds",
      "payment_processor_verifications_total",
      "payment_processor_verification_duration_seconds",
      "payment_processor_status_cache_hits_total",
      "payment_processor_status_cache_misses_total",
      "payment_processor_refunds_total",
      "payment_processor_list_requests_total",
    ]) {
      expect(text).toContain(name);
    }
  });

  it("tracks session outcomes per asset", async () => {
    paymentProcessorSessionsTotal.inc({ asset: "XLM", outcome: "created" });
    paymentProcessorSessionsTotal.inc({ asset: "USDC", outcome: "validation_failed" });

    const text = await metricText();
    expect(text).toContain('outcome="created"');
    expect(text).toContain('outcome="validation_failed"');
    expect(text).toContain('asset="USDC"');
  });

  it("observes session durations into histogram buckets", async () => {
    paymentProcessorSessionDuration.observe({ asset: "XLM", outcome: "created" }, 0.02);

    const text = await metricText();
    expect(text).toContain("payment_processor_session_duration_seconds_bucket");
  });

  it("distinguishes verification outcomes", async () => {
    const outcomes = [
      "confirmed",
      "already_confirmed",
      "pending_no_match",
      "signature_invalid",
      "underpayment",
      "overpayment",
      "tx_claim_conflict",
      "error",
    ];
    for (const outcome of outcomes) {
      paymentProcessorVerificationsTotal.inc({ asset: "XLM", outcome });
      paymentProcessorVerificationDuration.observe({ asset: "XLM", outcome }, 0.05);
    }

    const text = await metricText();
    for (const outcome of outcomes) {
      expect(text).toContain(`outcome="${outcome}"`);
    }
  });

  it("counts cache hits and misses independently", async () => {
    paymentProcessorStatusCacheHits.inc();
    paymentProcessorStatusCacheHits.inc();
    paymentProcessorStatusCacheMisses.inc();

    const text = await metricText();
    const hits = text.match(/payment_processor_status_cache_hits_total (\d+)/);
    const misses = text.match(/payment_processor_status_cache_misses_total (\d+)/);
    expect(Number(hits[1])).toBe(2);
    expect(Number(misses[1])).toBe(1);
  });

  it("tracks the refund funnel by stage and outcome", async () => {
    paymentProcessorRefundsTotal.inc({ stage: "generate", outcome: "success" });
    paymentProcessorRefundsTotal.inc({ stage: "generate", outcome: "rejected" });
    paymentProcessorRefundsTotal.inc({ stage: "confirm", outcome: "success" });

    const text = await metricText();
    expect(text).toContain('stage="generate",outcome="rejected"');
    expect(text).toContain('stage="confirm",outcome="success"');
  });

  it("tracks list request outcomes including pool fallback", async () => {
    paymentProcessorListRequestsTotal.inc({ outcome: "pool_fallback" });

    const text = await metricText();
    expect(text).toContain('outcome="pool_fallback"');
  });
});
