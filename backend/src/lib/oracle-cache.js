/**
 * Smart Contract Oracle Integrator
 *
 * Provides a robust caching mechanism for fetching and caching oracle data
 * from multiple providers. Features include:
 * - LRU cache with TTL-based expiration per provider
 * - Multi-provider support with automatic fallback
 * - Circuit breaker pattern for provider reliability
 * - Prometheus metrics for observability
 * - Configurable refresh intervals and staleness tolerance
 * - Graceful degradation with stale data fallback
 */

import { createHash } from "node:crypto";
import { logger } from "./logger.js";
import {
  oracleCacheHitTotal,
  oracleCacheMissTotal,
  oracleCacheSize,
  oracleFetchDuration,
  oracleFetchErrorsTotal,
  oracleStaleDataServedTotal,
  oracleCircuitBreakerTripsTotal,
} from "./metrics.js";

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_TTL_MS = 60_000;
const DEFAULT_STALE_TOLERANCE_MS = 300_000;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 30_000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_BASE_MS = 500;

/**
 * Generate a deterministic cache key for oracle data.
 */
export function generateOracleCacheKey(provider, feed, params = {}) {
  const payload = JSON.stringify({ provider, feed, params });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Per-provider LRU Cache with TTL and stale data support.
 */
export class OracleCache {
  constructor(name, { maxEntries = DEFAULT_MAX_ENTRIES, ttlMs = DEFAULT_TTL_MS, staleToleranceMs = DEFAULT_STALE_TOLERANCE_MS } = {}) {
    this.name = name;
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.staleToleranceMs = staleToleranceMs;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) {
      oracleCacheMissTotal.inc({ provider: this.name });
      return { hit: false, data: null, stale: false };
    }

    const entry = this.cache.get(key);
    const age = Date.now() - entry.insertedAt;

    if (age <= this.ttlMs) {
      this.cache.delete(key);
      this.cache.set(key, entry);
      oracleCacheHitTotal.inc({ provider: this.name });
      return { hit: true, data: entry.data, stale: false };
    }

    if (age <= this.ttlMs + this.staleToleranceMs) {
      oracleCacheHitTotal.inc({ provider: this.name });
      oracleStaleDataServedTotal.inc({ provider: this.name });
      logger.warn({ provider: this.name, cacheKey: key, ageMs: age }, "Serving stale oracle cache entry");
      return { hit: true, data: entry.data, stale: true };
    }

    this.cache.delete(key);
    oracleCacheMissTotal.inc({ provider: this.name });
    return { hit: false, data: null, stale: false };
  }

  set(key, data) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      logger.debug({ provider: this.name, evictedKey: oldestKey }, "Oracle cache evicted oldest entry");
    }

    this.cache.set(key, { data, insertedAt: Date.now() });
    oracleCacheSize.set({ provider: this.name }, this.cache.size);
  }

  invalidate(key) {
    this.cache.delete(key);
    oracleCacheSize.set({ provider: this.name }, this.cache.size);
  }

  clear() {
    const size = this.cache.size;
    this.cache.clear();
    oracleCacheSize.set({ provider: this.name }, 0);
    logger.info({ provider: this.name, clearedEntries: size }, "Oracle cache cleared");
    return size;
  }

  getStats() {
    return {
      name: this.name,
      size: this.cache.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      staleToleranceMs: this.staleToleranceMs,
    };
  }
}

/**
 * Per-provider circuit breaker state.
 */
const circuitBreakerStates = new Map();

function getCircuitBreakerState(provider) {
  if (!circuitBreakerStates.has(provider)) {
    circuitBreakerStates.set(provider, {
      failures: 0,
      lastFailureTime: null,
      state: "closed",
    });
  }
  return circuitBreakerStates.get(provider);
}

function isCircuitBreakerOpen(provider) {
  const s = getCircuitBreakerState(provider);
  if (s.state === "closed") return false;
  if (Date.now() - s.lastFailureTime >= CIRCUIT_BREAKER_RESET_MS) {
    s.state = "half-open";
    return false;
  }
  return true;
}

function recordCircuitBreakerSuccess(provider) {
  const s = getCircuitBreakerState(provider);
  s.failures = 0;
  s.state = "closed";
}

function recordCircuitBreakerFailure(provider) {
  const s = getCircuitBreakerState(provider);
  s.failures++;
  s.lastFailureTime = Date.now();
  if (s.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    s.state = "open";
    oracleCircuitBreakerTripsTotal.inc({ provider });
    logger.error({ provider, failures: s.failures }, "Oracle circuit breaker tripped");
  }
}

export function resetCircuitBreaker(provider) {
  if (provider) {
    circuitBreakerStates.delete(provider);
  } else {
    circuitBreakerStates.clear();
  }
}

export function getCircuitBreakerMetrics() {
  const snapshot = {};
  for (const [provider, state] of circuitBreakerStates.entries()) {
    snapshot[provider] = { ...state };
  }
  return snapshot;
}

/**
 * Retry wrapper with exponential backoff for oracle fetches.
 */
async function withRetry(fn, provider, attempt = 1) {
  try {
    return await fn();
  } catch (err) {
    if (attempt >= MAX_RETRY_ATTEMPTS) throw err;
    const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1) + Math.random() * 200;
    logger.warn({ provider, attempt, err: err.message, nextRetryMs: Math.round(delay) }, "Oracle fetch failed, retrying");
    await new Promise((resolve) => setTimeout(resolve, delay));
    return withRetry(fn, provider, attempt + 1);
  }
}

/**
 * Smart Contract Oracle Integrator
 *
 * Orchestrates fetching oracle data from configured providers with
 * LRU caching, circuit breaker protection, and provider fallback.
 */
export class SmartContractOracleIntegrator {
  constructor(options = {}) {
    this.caches = new Map();
    this.providers = new Map();

    const { providers = [], defaultTtlMs = DEFAULT_TTL_MS, defaultStaleToleranceMs = DEFAULT_STALE_TOLERANCE_MS } = options;
    this.defaultTtlMs = defaultTtlMs;
    this.defaultStaleToleranceMs = defaultStaleToleranceMs;

    for (const provider of providers) {
      this.registerProvider(provider);
    }
  }

  registerProvider(provider) {
    if (!provider.name) throw new Error("Provider must have a name");
    if (typeof provider.fetch !== "function") throw new Error("Provider must have a fetch function");
    this.providers.set(provider.name, provider);
    this.caches.set(
      provider.name,
      new OracleCache(provider.name, {
        maxEntries: provider.maxEntries || DEFAULT_MAX_ENTRIES,
        ttlMs: provider.ttlMs || this.defaultTtlMs,
        staleToleranceMs: provider.staleToleranceMs || this.defaultStaleToleranceMs,
      }),
    );
    logger.info({ provider: provider.name, ttlMs: provider.ttlMs || this.defaultTtlMs }, "Oracle provider registered");
  }

  getCache(providerName) {
    return this.caches.get(providerName);
  }

  /**
   * Fetch a data feed from a specific provider.
   * Returns cached data if fresh, otherwise fetches from the provider.
   */
  async fetch(providerName, feed, params = {}) {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Unknown oracle provider: ${providerName}`);
    }

    const cache = this.caches.get(providerName);
    const cacheKey = generateOracleCacheKey(providerName, feed, params);

    const cached = cache.get(cacheKey);
    if (cached.hit && !cached.stale) {
      return { data: cached.data, source: "cache", provider: providerName, feed, stale: false };
    }

    if (isCircuitBreakerOpen(providerName)) {
      if (cached.hit && cached.stale) {
        logger.warn({ provider: providerName, feed }, "Circuit breaker open, serving stale oracle data");
        return { data: cached.data, source: "stale-cache", provider: providerName, feed, stale: true };
      }
      throw new Error(`Circuit breaker open for provider: ${providerName}`);
    }

    const startTime = Date.now();
    try {
      const data = await withRetry(
        () => provider.fetch(feed, params),
        providerName,
      );

      cache.set(cacheKey, data);
      recordCircuitBreakerSuccess(providerName);
      oracleFetchDuration.observe({ provider: providerName, result: "success" }, (Date.now() - startTime) / 1000);

      logger.info({ provider: providerName, feed, durationMs: Date.now() - startTime }, "Oracle data fetched successfully");
      return { data, source: "provider", provider: providerName, feed, stale: false };
    } catch (err) {
      oracleFetchDuration.observe({ provider: providerName, result: "error" }, (Date.now() - startTime) / 1000);
      oracleFetchErrorsTotal.inc({ provider: providerName, error_type: err.code || "unknown" });
      recordCircuitBreakerFailure(providerName);

      if (cached.hit && cached.stale) {
        logger.error({ provider: providerName, feed, err: err.message }, "Provider fetch failed, serving stale data");
        return { data: cached.data, source: "stale-cache", provider: providerName, feed, stale: true };
      }

      throw err;
    }
  }

  /**
   * Fetch a data feed across all registered providers.
   * Returns the first successful result and aggregates errors.
   */
  async fetchWithFallback(feed, params = {}) {
    const errors = [];
    for (const [providerName] of this.providers) {
      try {
        const result = await this.fetch(providerName, feed, params);
        if (result.data !== null && result.data !== undefined) {
          return result;
        }
      } catch (err) {
        errors.push({ provider: providerName, error: err.message });
      }
    }
    throw new Error(`All oracle providers failed for feed ${feed}: ${errors.map((e) => `${e.provider} (${e.error})`).join(", ")}`);
  }

  /**
   * Batch fetch multiple data feeds.
   */
  async fetchBatch(queries) {
    const results = [];
    const errors = [];

    for (const query of queries) {
      try {
        const result = await this.fetch(query.provider, query.feed, query.params);
        results.push({ ...result, requestId: query.requestId });
      } catch (err) {
        errors.push({ provider: query.provider, feed: query.feed, error: err.message, requestId: query.requestId });
      }
    }

    return { results, errors };
  }

  /**
   * Invalidate cache entries for a specific provider and feed.
   */
  invalidateCache(providerName, feed, params = {}) {
    const cache = this.caches.get(providerName);
    if (!cache) return 0;
    const key = generateOracleCacheKey(providerName, feed, params);
    cache.invalidate(key);
    return 1;
  }

  clearAllCaches() {
    let total = 0;
    for (const cache of this.caches.values()) {
      total += cache.clear();
    }
    return total;
  }

  getStats() {
    const stats = {};
    for (const [name, cache] of this.caches.entries()) {
      stats[name] = cache.getStats();
    }
    return stats;
  }
}

/**
 * Built-in oracle providers.
 */

export const priceFeeds = {
  stellar: {
    name: "stellar",
    description: "Stellar DEX price feed via Horizon orderbooks",
    ttlMs: 30_000,
    staleToleranceMs: 120_000,
    maxEntries: 100,
    async fetch(feed, params = {}) {
      const { sellingAsset, buyingAsset } = params;
      if (!sellingAsset || !buyingAsset) {
        throw Object.assign(new Error("sellingAsset and buyingAsset are required"), { code: "INVALID_PARAMS" });
      }
      const { server } = await import("./stellar.js");
      const orderbook = await server.orderbook(sellingAsset, buyingAsset).call();
      const bestBid = orderbook.bids?.[0]?.price || null;
      const bestAsk = orderbook.asks?.[0]?.price || null;
      const midPrice = bestBid && bestAsk ? (parseFloat(bestBid) + parseFloat(bestAsk)) / 2 : null;
      return {
        price: midPrice,
        bid: bestBid,
        ask: bestAsk,
        timestamp: new Date().toISOString(),
        source: "stellar-dex",
      };
    },
  },
};

export function createDefaultIntegrator() {
  return new SmartContractOracleIntegrator({
    providers: Object.values(priceFeeds),
  });
}

export const oracleIntegrator = createDefaultIntegrator();
