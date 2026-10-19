import { describe, it, expect, beforeEach } from "vitest";
import {
  trustlineSignatureVerificationsTotal,
  trustlineSignatureVerificationDuration,
  trustlineSignatureVerificationCacheHits,
  trustlineRateLimitRejectionsTotal,
  trustlineCircuitBreakerOpen,
  trustlineCircuitBreakerFailures,
  trustlineErrorRecoveryTotal,
  trustlineDeadLetterQueueDepth,
  trustlineDeadLetterQueueEntriesTotal,
  trustlineManagerRegister,
  recordTrustlineSignatureVerification,
  recordTrustlineSignatureCacheHit,
  recordTrustlineRateLimitRejection,
  setTrustlineCircuitBreakerState,
  recordTrustlineRecoveryOutcome,
  recordTrustlineDeadLetterEntry,
  setTrustlineDeadLetterQueueDepth,
  resetTrustlineManagerMetrics,
} from "./trustline-manager-metrics.js";

async function metricText() {
  return trustlineManagerRegister.metrics();
}

describe("trustline-manager-metrics (issue #1043)", () => {
  beforeEach(() => {
    resetTrustlineManagerMetrics();
  });

  it("registers every granular series on its own registry", async () => {
    const text = await metricText();
    for (const name of [
      "trustline_signature_verifications_total",
      "trustline_signature_verification_duration_seconds",
      "trustline_signature_verification_cache_hits_total",
      "trustline_rate_limit_rejections_total",
      "trustline_circuit_breaker_open",
      "trustline_circuit_breaker_failures",
      "trustline_error_recovery_total",
      "trustline_dead_letter_queue_depth",
      "trustline_dead_letter_queue_entries_total",
    ]) {
      expect(text).toContain(name);
    }
  });

  it("tracks verification outcomes independently", async () => {
    recordTrustlineSignatureVerification("valid", 0.05);
    recordTrustlineSignatureVerification("valid", 0.05);
    recordTrustlineSignatureVerification("invalid");
    recordTrustlineSignatureVerification("error");

    const text = await metricText();
    const valid = text.match(
      /trustline_signature_verifications_total\{outcome="valid"\} (\d+)/,
    );
    expect(Number(valid[1])).toBe(2);
    expect(text).toContain('outcome="invalid"');
    expect(text).toContain('outcome="error"');
    expect(text).toContain(
      "trustline_signature_verification_duration_seconds_bucket",
    );
  });

  it("counts signature verification cache hits", async () => {
    recordTrustlineSignatureCacheHit();
    recordTrustlineSignatureCacheHit();

    const text = await metricText();
    const hits = text.match(
      /trustline_signature_verification_cache_hits_total (\d+)/,
    );
    expect(Number(hits[1])).toBe(2);
  });

  it("tracks rate limit rejections per limiter track", async () => {
    recordTrustlineRateLimitRejection("burst");
    recordTrustlineRateLimitRejection("operations");
    recordTrustlineRateLimitRejection("operations");
    recordTrustlineRateLimitRejection("verifications");

    const text = await metricText();
    const burst = text.match(
      /trustline_rate_limit_rejections_total\{limiter="burst"\} (\d+)/,
    );
    expect(Number(burst[1])).toBe(1);
    expect(text).toContain('limiter="verifications"');
  });

  it("publishes circuit breaker state and failure counts per context", async () => {
    setTrustlineCircuitBreakerState("horizon", true, 5);
    setTrustlineCircuitBreakerState("db", false, 0);

    const text = await metricText();
    expect(text).toContain('trustline_circuit_breaker_open{context="horizon"} 1');
    expect(text).toContain('trustline_circuit_breaker_open{context="db"} 0');
    expect(text).toContain('trustline_circuit_breaker_failures{context="horizon"} 5');
  });

  it("tracks recovery outcomes per context", async () => {
    recordTrustlineRecoveryOutcome("verify-ctx", true);
    recordTrustlineRecoveryOutcome("verify-ctx", false);

    const text = await metricText();
    expect(text).toContain(
      'trustline_error_recovery_total{context="verify-ctx",outcome="success"} 1',
    );
    expect(text).toContain(
      'trustline_error_recovery_total{context="verify-ctx",outcome="failure"} 1',
    );
  });

  it("publishes dead-letter queue depth and entries by error type", async () => {
    recordTrustlineDeadLetterEntry(1, "asset_not_found");
    recordTrustlineDeadLetterEntry(2, "auth_error");

    let text = await metricText();
    expect(text).toContain("trustline_dead_letter_queue_depth 2");
    expect(text).toContain('trustline_dead_letter_queue_entries_total{error_type="asset_not_found"} 1');
    expect(text).toContain('trustline_dead_letter_queue_entries_total{error_type="auth_error"} 1');

    setTrustlineDeadLetterQueueDepth(0);
    text = await metricText();
    expect(text).toContain("trustline_dead_letter_queue_depth 0");
  });

  it("reset clears every series", async () => {
    recordTrustlineSignatureVerification("valid");
    recordTrustlineRateLimitRejection("operations");
    setTrustlineCircuitBreakerState("ctx", true, 3);

    resetTrustlineManagerMetrics();

    const text = await metricText();
    expect(text).not.toContain('outcome="valid"');
    expect(text).not.toContain('limiter="operations"');
    expect(text).not.toContain('context="ctx"');
  });
});
