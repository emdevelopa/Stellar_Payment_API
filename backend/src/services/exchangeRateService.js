/**
 * Multi-currency Exchange Rate Service
 *
 * Refactored from the inline path-payment-quote route handler into a dedicated
 * service module with clear responsibilities:
 *   1. Cache-first lookup via ExchangeRateCache
 *   2. Horizon strict-receive-path query on cache miss
 *   3. Slippage application + response shaping
 *   4. Prometheus metrics
 *
 * The route handler calls getExchangeRateQuote() and only handles HTTP concerns;
 * all exchange-rate logic lives here.
 */

import { findStrictReceivePaths } from '../lib/stellar.js';
import {
  getExchangeRateCache,
  generateRateCacheKey,
} from '../lib/exchange-rate-cache.js';
import { logger } from '../lib/logger.js';

const DEFAULT_SLIPPAGE = parseFloat(process.env.PATH_PAYMENT_SLIPPAGE ?? '0.01');

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
export async function getExchangeRateQuote({
  sourceAssetCode,
  sourceAssetIssuer = null,
  destAssetCode,
  destAssetIssuer = null,
  destAmount,
  sourceAccount = null,
  slippage = DEFAULT_SLIPPAGE,
}) {
  const cache = getExchangeRateCache();
  const cacheKey = generateRateCacheKey(
    sourceAssetCode,
    destAssetCode,
    destAmount,
    sourceAssetIssuer,
    destAssetIssuer,
  );

  const cached = cache.get(cacheKey);
  if (cached.hit && !cached.stale) {
    logger.debug('exchange_rate_cache: HIT');
    return { ...cached.data, cached: true };
  }

  if (cached.hit && cached.stale) {
    logger.debug('exchange_rate_cache: STALE — revalidating');
  }

  logger.debug('exchange_rate_cache: MISS — querying Horizon');

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

  cache.set(cacheKey, quote);
  return quote;
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
  const key = generateRateCacheKey(sourceAsset, destAsset, destAmount, sourceAssetIssuer, destAssetIssuer);
  return cache.delete(key);
}
