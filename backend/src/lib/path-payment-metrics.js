import client from "prom-client";

/**
 * Granular Path Payment Service metrics (issue #1048).
 *
 * The coarse series (exchange_rate_quote_requests_total, horizon client
 * metrics in lib/metrics.js) cannot answer questions about the quote
 * pipeline itself. This module tracks FINE-GRAINED path-payment internals:
 *
 *   - Endpoint outcome breakdown incl. CACHED quotes, which the
 *     Horizon-level exchange_rate_* series never see (cache hits never
 *     reach Horizon)
 *   - HOW LONG each pipeline stage takes (payment lookup vs Horizon quote)
 *   - Read-through cache effectiveness (hits/misses/evictions/occupancy)
 *   - Path complexity (hop count) per quote
 *   - How much the send-max slippage buffer overpays relative to the
 *     destination amount
 *
 * The metrics live in their own registry so they can be unit-tested in
 * isolation; the /metrics endpoint merges this registry with the main one.
 */

const register = new client.Registry();

register.setDefaultLabels({
  app: "stellar-payment-api",
});

/**
 * Quote outcomes.
 * outcome: success | no_path | not_found | not_pending | same_asset | error
 */
export const pathPaymentQuoteRequestsTotal = new client.Counter({
  name: "path_payment_quote_requests_total",
  help: "Total number of path payment quote requests, by outcome (incl. cached quotes)",
  labelNames: ["source_asset", "dest_asset", "outcome"],
});

/**
 * Pipeline stage wall-clock time.
 * stage: payment_lookup | horizon_quote
 */
export const pathPaymentQuoteStageDuration = new client.Histogram({
  name: "path_payment_quote_stage_duration_seconds",
  help: "Duration of each path payment quote pipeline stage in seconds",
  labelNames: ["stage"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

/** Read-through cache effectiveness for exchange-rate quotes. */
export const pathPaymentQuoteCacheHits = new client.Counter({
  name: "path_payment_quote_cache_hits_total",
  help: "Total number of exchange-rate quote reads served from cache",
  labelNames: ["cache", "stale"],
});

export const pathPaymentQuoteCacheMisses = new client.Counter({
  name: "path_payment_quote_cache_misses_total",
  help: "Total number of exchange-rate quote reads that missed the cache",
  labelNames: ["cache"],
});

export const pathPaymentQuoteCacheEvictions = new client.Counter({
  name: "path_payment_quote_cache_evictions_total",
  help: "Total number of exchange-rate quote cache entries evicted by LRU pressure",
  labelNames: ["cache"],
});

export const pathPaymentQuoteCacheSize = new client.Gauge({
  name: "path_payment_quote_cache_size",
  help: "Current number of entries in the exchange-rate quote cache",
  labelNames: ["cache"],
});

/**
 * Exchange-rate cache concurrency control (issue #1445).
 * In-process single-flight + cross-instance Redis lock coordination.
 */
export const exchangeRateCacheCoalescedRequests = new client.Counter({
  name: "exchange_rate_cache_coalesced_requests_total",
  help: "Quote requests that joined an in-flight load instead of querying Horizon",
  labelNames: ["cache"],
});

export const exchangeRateCacheInflightLoads = new client.Gauge({
  name: "exchange_rate_cache_inflight_loads",
  help: "Exchange-rate quote loads currently in flight in this process",
  labelNames: ["cache"],
});

export const exchangeRateCacheLoadTimeouts = new client.Counter({
  name: "exchange_rate_cache_load_timeouts_total",
  help: "Exchange-rate quote loads that exceeded the load timeout",
  labelNames: ["cache"],
});

export const exchangeRateCacheStaleWritesPrevented = new client.Counter({
  name: "exchange_rate_cache_stale_writes_prevented_total",
  help: "Loads whose result was not cached because the key was invalidated mid-flight",
  labelNames: ["cache"],
});

/** result: acquired | contended | error */
export const exchangeRateLockAcquisitions = new client.Counter({
  name: "exchange_rate_lock_acquisitions_total",
  help: "Distributed exchange-rate lock acquisition attempts, by result",
  labelNames: ["result"],
});

/** outcome: shared_hit | acquired | timeout | error */
export const exchangeRateLockWaitDuration = new client.Histogram({
  name: "exchange_rate_lock_wait_seconds",
  help: "Time spent coordinating with other instances before a quote was available",
  labelNames: ["outcome"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

/** result: hit | miss | invalid | error */
export const exchangeRateSharedCacheLookups = new client.Counter({
  name: "exchange_rate_shared_cache_lookups_total",
  help: "Lookups against the Redis-backed shared exchange-rate quote cache, by result",
  labelNames: ["result"],
});

/** reason: wait_timeout | redis_error */
export const exchangeRateCoordinationFallbacks = new client.Counter({
  name: "exchange_rate_coordination_fallbacks_total",
  help: "Quote loads that bypassed distributed coordination and queried Horizon directly",
  labelNames: ["reason"],
});

/** Number of intermediate assets in the returned path (0 = direct pair). */
export const pathPaymentQuotePathHops = new client.Histogram({
  name: "path_payment_quote_path_hops",
  help: "Number of hops in the best path returned per quote",
  buckets: [0, 1, 2, 3, 4, 5, 6, 7, 8],
});

/**
 * Quote rate — source_amount / destination_amount for the best path
 * (e.g. 0.5 XLM per 1 USDC), tracked per asset pair.
 */
export const pathPaymentQuoteRate = new client.Histogram({
  name: "path_payment_quote_rate",
  help: "Exchange rate per quote (source_amount / destination_amount), by asset pair",
  labelNames: ["source_asset", "dest_asset"],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 50, 100, 1000],
});

register.registerMetric(pathPaymentQuoteRequestsTotal);
register.registerMetric(pathPaymentQuoteStageDuration);
register.registerMetric(pathPaymentQuoteCacheHits);
register.registerMetric(pathPaymentQuoteCacheMisses);
register.registerMetric(pathPaymentQuoteCacheEvictions);
register.registerMetric(pathPaymentQuoteCacheSize);
register.registerMetric(exchangeRateCacheCoalescedRequests);
register.registerMetric(exchangeRateCacheInflightLoads);
register.registerMetric(exchangeRateCacheLoadTimeouts);
register.registerMetric(exchangeRateCacheStaleWritesPrevented);
register.registerMetric(exchangeRateLockAcquisitions);
register.registerMetric(exchangeRateLockWaitDuration);
register.registerMetric(exchangeRateSharedCacheLookups);
register.registerMetric(exchangeRateCoordinationFallbacks);
register.registerMetric(pathPaymentQuotePathHops);
register.registerMetric(pathPaymentQuoteRate);

export { register as pathPaymentRegister };
