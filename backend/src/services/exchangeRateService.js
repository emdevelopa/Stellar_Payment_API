

import { findStrictReceivePaths } from '../lib/stellar.js';
import {
  getExchangeRateCache,
  generateRateCacheKey,
} from '../lib/exchange-rate-cache.js';
import { ExchangeRateCoordinator } from '../lib/exchange-rate-coordinator.js';
import { withOracleRetry } from '../lib/exchange-rate-oracle-retry.js';
import { logger } from '../lib/logger.js';
import {
  sanitizeQuote,
  sanitizeQuoteRequest,
  ExchangeRateValidationError,
} from '../lib/exchange-rate-oracle-sanitizer.js';

export { ExchangeRateValidationError };

const DEFAULT_SLIPPAGE = parseFloat(process.env.PATH_PAYMENT_SLIPPAGE ?? '0.01');

/** Upper bound on a single quote load, so waiters are never pinned forever. */
const LOAD_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.EXCHANGE_RATE_LOAD_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
})();

/** @type {ExchangeRateCoordinator|null} */
let coordinator = null;

/**
 * Enable cross-instance coordination. Call once at startup with a connected
 * Redis client; passing a missing/closed client leaves coordination disabled.
 *
 * @param {object} opts
 * @param {object|null} opts.redisClient
 * @returns {boolean} whether coordination is enabled
 */
export function configureExchangeRateCoordination({ redisClient, ...options } = {}) {
  if (!redisClient?.isOpen || typeof redisClient.sendCommand !== 'function') {
    coordinator = null;
    return false;
  }
  coordinator = new ExchangeRateCoordinator({ redisClient, sanitize: sanitizeQuote, ...options });
  logger.info('Exchange-rate cache distributed coordination enabled');
  return true;
}

/** Disable cross-instance coordination (test isolation / shutdown). */
export function resetExchangeRateCoordination() {
  coordinator = null;
}

export class ExchangeRateError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'ExchangeRateError';
    this.statusCode = statusCode;
  }
}

export class NoPathFoundError extends ExchangeRateError {
  constructor(sourceAsset, destAsset) {
    super(`No path found for ${sourceAsset} to ${destAsset}`, 404);
    this.name = 'NoPathFoundError';
  }
}

/**
 * Fetch an exchange rate quote for a path payment, with caching.
 *
 * @param {object} params
 * @param {string} params.sourceAssetCode
 * @param {string|null} params.sourceAssetIssuer
 * @param {string} params.destAssetCode
 * @param {string|null} params.destAssetIssuer
 * @param {string} params.destAmount
 * @param {string|null} [params.sourceAccount]
 * @param {number} [params.slippage]
 * @returns {Promise<ExchangeRateQuote>}
 */
export async function getExchangeRateQuote(params) {
  const {
    sourceAssetCode,
    sourceAssetIssuer,
    destAssetCode,
    destAssetIssuer,
    destAmount,
    sourceAccount,
    slippage,
  } = sanitizeQuoteRequest({ slippage: DEFAULT_SLIPPAGE, ...(params ?? {}) });

  const cache = getExchangeRateCache();
  const cacheKey = generateRateCacheKey(
    sourceAssetCode,
    destAssetCode,
    destAmount,
    sourceAssetIssuer,
    destAssetIssuer,
  );

  const fetchFromHorizon = () => withOracleRetry(
    () => fetchQuoteFromHorizon({
      sourceAssetCode,
      sourceAssetIssuer,
      destAssetCode,
      destAssetIssuer,
      destAmount,
      sourceAccount,
      slippage,
    }),
    { label: 'exchange-rate-oracle-fetch' },
  );

  // Captured per call so a later reconfiguration cannot change an in-flight load.
  const activeCoordinator = coordinator;
  const loader = activeCoordinator
    ? async () => {
        const { data, source } = await activeCoordinator.load(cacheKey, fetchFromHorizon);
        // A quote reused from a peer instance never reached Horizon here.
        return { ...data, cached: source === 'shared' };
      }
    : fetchFromHorizon;

  const { data, source } = await cache.getOrLoad(cacheKey, loader, {
    timeoutMs: LOAD_TIMEOUT_MS,
  });

  if (source === 'loader') {
    logger.debug('exchange_rate_cache: MISS — loaded');
    return data;
  }

  // 'cache' (fresh hit) or 'coalesced' (joined another caller's load):
  // either way this request did not query Horizon itself.
  logger.debug(`exchange_rate_cache: ${source === 'cache' ? 'HIT' : 'COALESCED'}`);
  return { ...data, cached: true };
}

async function fetchQuoteFromHorizon({
  sourceAssetCode,
  sourceAssetIssuer,
  destAssetCode,
  destAssetIssuer,
  destAmount,
  sourceAccount,
  slippage,
}) {
  const path = await findStrictReceivePaths({
    sourceAccount,
    destAssetCode,
    destAssetIssuer,
    destAmount,
    sourceAssetCode,
    sourceAssetIssuer,
  });

  if (!path) {
    throw new NoPathFoundError(sourceAssetCode, destAssetCode);
  }

  const sendMax = (parseFloat(path.source_amount) * (1 + slippage)).toFixed(7);

  const quote = {
    sourceAsset:             path.source_asset_code ?? sourceAssetCode,
    sourceAssetIssuer:       path.source_asset_issuer ?? sourceAssetIssuer,
    sourceAmount:            path.source_amount,
    sendMax,
    destinationAsset:        destAssetCode,
    destinationAssetIssuer:  destAssetIssuer,
    destinationAmount:       destAmount,
    path:                    path.path ?? [],
    slippage,
    cached:                  false,
  };

  const sanitized = sanitizeQuote(quote);
  if (!sanitized) {
    logger.warn(
      { sourceAsset: sourceAssetCode, destAsset: destAssetCode, hops: Array.isArray(path.path) ? path.path.length : null },
      'Rejected malformed exchange rate quote from Horizon',
    );
    const error = new ExchangeRateError('Horizon returned an invalid exchange rate quote', 502);
    error.status = 502;
    // The same Horizon answer would be rejected again; do not retry it.
    error.retryable = false;
    throw error;
  }
  return sanitized;
}

/**
 * Cache key for possibly-unsanitized parameters. Invalidation must never
 * throw, so input that fails strict validation falls back to the raw key
 * (it can only match an entry that was never written).
 */
function resolveCacheKey(sourceAsset, destAsset, destAmount, sourceAssetIssuer, destAssetIssuer) {
  try {
    const clean = sanitizeQuoteRequest({
      sourceAssetCode: sourceAsset,
      sourceAssetIssuer,
      destAssetCode: destAsset,
      destAssetIssuer,
      destAmount,
      slippage: 0,
    });
    return generateRateCacheKey(
      clean.sourceAssetCode,
      clean.destAssetCode,
      clean.destAmount,
      clean.sourceAssetIssuer,
      clean.destAssetIssuer,
    );
  } catch {
    return generateRateCacheKey(sourceAsset, destAsset, destAmount, sourceAssetIssuer, destAssetIssuer);
  }
}

/**
 * Invalidate the cached quote for a specific asset pair + amount.
 * Call this when a payment status changes and its quote is no longer valid.
 */
export function invalidateExchangeRateQuote(
  sourceAsset,
  destAsset,
  destAmount,
  sourceAssetIssuer = null,
  destAssetIssuer = null,
) {
  const cache = getExchangeRateCache();
  const key = resolveCacheKey(sourceAsset, destAsset, destAmount, sourceAssetIssuer, destAssetIssuer);
  const removed = cache.delete(key);

  // Propagate to peers via the shared store. Fire-and-forget keeps this
  // function synchronous for existing callers; failures only mean peers
  // keep the quote until its short TTL expires.
  coordinator?.invalidate(key).catch((err) => {
    logger.warn({ err: err?.message }, 'Failed to invalidate shared exchange-rate quote');
  });

  return removed;
}
