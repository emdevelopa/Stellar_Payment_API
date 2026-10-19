import { describe, it, expect, beforeEach } from "vitest";
import {
  pathPaymentQuoteRequestsTotal,
  pathPaymentQuoteStageDuration,
  pathPaymentQuoteCacheHits,
  pathPaymentQuoteCacheMisses,
  pathPaymentQuoteCacheEvictions,
  pathPaymentQuoteCacheSize,
  pathPaymentQuotePathHops,
  pathPaymentQuoteRate,
  pathPaymentRegister,
} from "./path-payment-metrics.js";

async function metricText() {
  return pathPaymentRegister.metrics();
}

describe("path-payment-metrics (issue #1048)", () => {
  beforeEach(async () => {
    pathPaymentQuoteRequestsTotal.reset();
    pathPaymentQuoteStageDuration.reset();
    pathPaymentQuoteCacheHits.reset();
    pathPaymentQuoteCacheMisses.reset();
    pathPaymentQuoteCacheEvictions.reset();
    pathPaymentQuoteCacheSize.reset();
    pathPaymentQuotePathHops.reset();
    pathPaymentQuoteRate.reset();
  });

  it("registers every granular series on its own registry", async () => {
    const text = await metricText();
    for (const name of [
      "path_payment_quote_requests_total",
      "path_payment_quote_stage_duration_seconds",
      "path_payment_quote_cache_hits_total",
      "path_payment_quote_cache_misses_total",
      "path_payment_quote_cache_evictions_total",
      "path_payment_quote_cache_size",
      "path_payment_quote_path_hops",
      "path_payment_quote_rate",
    ]) {
      expect(text).toContain(name);
    }
  });

  it("tracks quote outcomes per asset pair", async () => {
    pathPaymentQuoteRequestsTotal.inc({ source_asset: "XLM", dest_asset: "USDC", outcome: "success" });
    pathPaymentQuoteRequestsTotal.inc({ source_asset: "XLM", dest_asset: "USDC", outcome: "no_path" });
    pathPaymentQuoteRequestsTotal.inc({ source_asset: "XLM", dest_asset: "EUR", outcome: "same_asset" });

    const text = await metricText();
    expect(text).toContain('outcome="success"');
    expect(text).toContain('outcome="no_path"');
    expect(text).toContain('outcome="same_asset"');
    expect(text).toContain('dest_asset="USDC"');
  });

  it("observes stage durations into histogram buckets", async () => {
    pathPaymentQuoteStageDuration.observe({ stage: "payment_lookup" }, 0.004);
    pathPaymentQuoteStageDuration.observe({ stage: "horizon_quote" }, 0.3);

    const text = await metricText();
    expect(text).toContain("path_payment_quote_stage_duration_seconds_bucket");
    expect(text).toContain('stage="payment_lookup"');
    expect(text).toContain('stage="horizon_quote"');
  });

  it("tracks cache hit/miss/eviction with the cache label", async () => {
    pathPaymentQuoteCacheHits.inc({ cache: "exchange_rate", stale: "0" });
    pathPaymentQuoteCacheHits.inc({ cache: "exchange_rate", stale: "1" });
    pathPaymentQuoteCacheMisses.inc({ cache: "exchange_rate" });
    pathPaymentQuoteCacheEvictions.inc({ cache: "exchange_rate" });
    pathPaymentQuoteCacheSize.set({ cache: "exchange_rate" }, 3);

    const text = await metricText();
    expect(text).toContain('path_payment_quote_cache_hits_total{cache="exchange_rate",stale="0"}');
    expect(text).toContain('path_payment_quote_cache_hits_total{cache="exchange_rate",stale="1"}');
    expect(text).toContain('path_payment_quote_cache_misses_total{cache="exchange_rate"}');
    expect(text).toContain('path_payment_quote_cache_evictions_total{cache="exchange_rate"}');
    expect(text).toContain('path_payment_quote_cache_size{cache="exchange_rate"} 3');
  });

  it("records path hop counts into buckets", async () => {
    pathPaymentQuotePathHops.observe(0);
    pathPaymentQuotePathHops.observe(2);

    const text = await metricText();
    expect(text).toContain("path_payment_quote_path_hops_bucket");
    expect(text).toContain('path_payment_quote_path_hops_sum 2');
  });

  it("records quote rates per asset pair", async () => {
    pathPaymentQuoteRate.observe({ source_asset: "XLM", dest_asset: "USDC" }, 0.5);
    pathPaymentQuoteRate.observe({ source_asset: "EUR", dest_asset: "XLM" }, 3.2);

    const text = await metricText();
    expect(text).toContain("path_payment_quote_rate_bucket");
    expect(text).toContain('source_asset="XLM"');
    expect(text).toContain('dest_asset="USDC"');
    expect(text).toContain("path_payment_quote_rate_sum 3.7");
  });
});
