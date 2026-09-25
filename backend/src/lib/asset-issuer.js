/**
 * Asset Issuer Service - Enhanced error recovery, rate limiting, signature verification, and optimized queries
 * 
 * This module provides comprehensive asset issuer management functionality with:
 * - Issue #890: Enhanced error recovery mechanisms
 * - Issue #887: Rate limiting for asset issuer operations
 * - Issue #888: Cryptographic signature verification for asset operations
 * - Issue #889: Optimized SQL queries for asset and issuer data
 * - Issue #1052: Refactored legacy code — shared Horizon client, de-duplicated
 *   rate-limit actor resolution, dead-letter/fallback logging, bounded
 *   `getRecoveryHealth()` snapshot
 */

import { createHash } from "node:crypto";
import * as StellarSdk from "stellar-sdk";
import { queryWithRetry } from "./db.js";
import {
    isValidStellarAccountId,
    verifyTransactionSignature,
    withHorizonRetry,
    isValidAssetCode,
    isValidStellarPublicKey
} from "./stellar.js";
import { ipKeyGenerator } from "express-rate-limit";
import rateLimit from "express-rate-limit";
import {
    createRedisRateLimitStore,
    RATE_LIMIT_REDIS_PREFIX,
} from "./rate-limit.js";
import { logger } from "./logger.js";

// Rate limiting constants
export const ASSET_ISSUER_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const ASSET_ISSUER_RATE_LIMIT_MAX = 50;
export const ASSET_ISSUER_BURST_WINDOW_MS = 10 * 1000; // 10 seconds
export const ASSET_ISSUER_BURST_MAX = 10;

// Error recovery constants
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_BASE_MS = 1000;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT_MS = 30 * 1000;
const CIRCUIT_BREAKER_HALF_OPEN_PROBE_MS = 5 * 1000;
const OPERATION_TIMEOUT_MS = 15 * 1000;
const DLQ_MAX_SIZE = 100;
// Issue #1312: bounds for in-memory registries that were previously unbounded.
const CIRCUIT_BREAKER_MAX_CONTEXTS = 1000;
const VERIFICATION_CACHE_MAX_ENTRIES = 1000;

// Issue #1050: bounds and TTL for the issuer query cache.
const ISSUER_QUERY_CACHE_TTL_MS = 60 * 1000;
const ISSUER_QUERY_CACHE_MAX_ENTRIES = 500;

/**
 * Issue #1050: bounded TTL cache for Asset Issuer query results.
 *
 * `AssetIssuerSignatureVerifier` already caches per-transaction verification
 * results, but the aggregate read paths (`getIssuerStats`,
 * `getAssetIssuerHealthMetrics`) re-queried the database on every call. Those
 * results are derived from payment rows and change slowly, so a short TTL
 * removes the repeated round trip without serving materially stale data.
 *
 * Expired entries are dropped on read rather than only on write, and the map
 * is hard-capped with oldest-first eviction so a stream of distinct
 * issuer/merchant keys cannot grow it without bound.
 */
class IssuerQueryCache {
    constructor({ ttlMs = ISSUER_QUERY_CACHE_TTL_MS, maxEntries = ISSUER_QUERY_CACHE_MAX_ENTRIES } = {}) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this.entries = new Map();
        this.stats = { hits: 0, misses: 0, evictions: 0, expirations: 0 };
    }

    get(key) {
        const entry = this.entries.get(key);
        if (!entry) {
            this.stats.misses++;
            return undefined;
        }
        if (Date.now() - entry.timestamp >= this.ttlMs) {
            this.entries.delete(key);
            this.stats.expirations++;
            this.stats.misses++;
            return undefined;
        }
        // Re-insert to refresh recency for LRU ordering.
        this.entries.delete(key);
        this.entries.set(key, entry);
        this.stats.hits++;
        return entry.value;
    }

    set(key, value) {
        if (this.entries.has(key)) {
            this.entries.delete(key);
        }
        while (this.entries.size >= this.maxEntries) {
            this.entries.delete(this.entries.keys().next().value);
            this.stats.evictions++;
        }
        this.entries.set(key, { value, timestamp: Date.now() });
    }

    delete(key) {
        return this.entries.delete(key);
    }

    clear() {
        this.entries.clear();
    }

    getStats() {
        return {
            size: this.entries.size,
            ttlMs: this.ttlMs,
            maxEntries: this.maxEntries,
            ...this.stats,
        };
    }
}

const issuerQueryCache = new IssuerQueryCache();

/**
 * Per-context circuit breaker states for failure domain isolation.
 */
const circuitBreakerRegistry = new Map();

/**
 * In-memory dead-letter queue for operations that exhausted retries.
 */
const deadLetterQueue = [];

/**
 * Lazily-initialized shared Horizon server.
 *
 * Previously every verification built its own `new StellarSdk.Horizon.Server(...)`,
 * which meant a fresh client (and its internal agent/socket setup) per call and
 * no reuse of connections under load.
 */
let _horizonServer = null;

function getHorizonServer() {
    if (!_horizonServer) {
        const NETWORK = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
        _horizonServer = new StellarSdk.Horizon.Server(
            process.env.STELLAR_HORIZON_URL ||
            (NETWORK === "public"
                ? "https://horizon.stellar.org"
                : "https://horizon-testnet.stellar.org")
        );
    }
    return _horizonServer;
}

/**
 * Issue #890: Enhanced error recovery for asset issuer operations
 *
 * Improvements over the previous implementation:
 * - Per-context circuit breakers (failure domains are isolated)
 * - Half-open state with probe support for automatic recovery
 * - Operation timeout wrapper (prevents runaway async calls)
 * - Dead-letter queue for unrecoverable failures
 * - Fallback handler support for graceful degradation
 * - Error metrics per context (failure counts, last error, recovery counts)
 * - Extended error classification for asset-specific errors
 */
export class AssetIssuerErrorRecovery {

    // ─── Circuit Breaker Helpers ────────────────────────────────────────────────

    static _getState(context = 'default') {
        if (!circuitBreakerRegistry.has(context)) {
            // Issue #1312: contexts embed per-transaction/issuer/merchant
            // identifiers, so the registry grew without bound. Evict the
            // oldest closed (healthy) context first, then the oldest overall.
            if (circuitBreakerRegistry.size >= CIRCUIT_BREAKER_MAX_CONTEXTS) {
                let evictKey = circuitBreakerRegistry.keys().next().value;
                for (const [key, entry] of circuitBreakerRegistry) {
                    if (entry.state === 'closed') {
                        evictKey = key;
                        break;
                    }
                }
                circuitBreakerRegistry.delete(evictKey);
            }
            circuitBreakerRegistry.set(context, {
                failures: 0,
                lastFailureTime: null,
                state: 'closed',
                successAfterHalfOpen: 0,
                metrics: {
                    totalFailures: 0,
                    totalRecoveries: 0,
                    lastErrorMessage: null,
                    lastErrorTime: null,
                },
            });
        }
        return circuitBreakerRegistry.get(context);
    }

    static _circuitBreakerDisposition(context) {
        const s = this._getState(context);
        const now = Date.now();

        if (s.state === 'closed') return 'allow';

        if (s.state === 'open') {
            const elapsed = now - s.lastFailureTime;
            if (elapsed >= CIRCUIT_BREAKER_TIMEOUT_MS) {
                s.state = 'half-open';
                s.successAfterHalfOpen = 0;
                return 'probe';
            }
            return 'reject';
        }

        if (s.state === 'half-open') return 'probe';
        return 'allow';
    }

    static _recordFailure(context, error) {
        const s = this._getState(context);
        s.failures++;
        s.lastFailureTime = Date.now();
        s.metrics.totalFailures++;
        s.metrics.lastErrorMessage = error?.message ?? String(error);
        s.metrics.lastErrorTime = new Date().toISOString();

        if (s.state === 'half-open') {
            s.state = 'open';
        } else if (s.failures >= CIRCUIT_BREAKER_THRESHOLD) {
            s.state = 'open';
        }
    }

    static _recordSuccess(context) {
        const s = this._getState(context);
        if (s.state === 'half-open') {
            s.state = 'closed';
            s.failures = 0;
            s.metrics.totalRecoveries++;
        } else {
            s.failures = 0;
            s.metrics.totalRecoveries++;
        }
    }

    // ─── Dead-Letter Queue ───────────────────────────────────────────────────────

    static _pushToDeadLetterQueue(entry) {
        if (deadLetterQueue.length >= DLQ_MAX_SIZE) {
            const evicted = deadLetterQueue.shift();
            logger.warn(
                { context: evicted?.context, dlqSize: deadLetterQueue.length },
                'Asset issuer dead-letter queue full, evicted oldest entry'
            );
        }
        deadLetterQueue.push({
            ...entry,
            enqueuedAt: new Date().toISOString(),
        });
        logger.warn(
            { context: entry.context, errorType: entry.errorType, attempts: entry.attempts },
            'Asset issuer operation added to dead-letter queue'
        );
    }

    static getDeadLetterQueue() {
        return [...deadLetterQueue];
    }

    static drainDeadLetterQueue() {
        return deadLetterQueue.splice(0, deadLetterQueue.length);
    }

    // ─── Timeout Wrapper ─────────────────────────────────────────────────────────

    static withTimeout(promise, ms = OPERATION_TIMEOUT_MS, label = 'operation') {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                const err = new Error(`${label} timed out after ${ms}ms`);
                err.isTimeout = true;
                reject(err);
            }, ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    // ─── Core Execution ──────────────────────────────────────────────────────────

    static async executeWithRecovery(
        operation,
        context = 'asset issuer operation',
        { timeoutMs = OPERATION_TIMEOUT_MS, fallback = null, maxAttempts = MAX_RETRY_ATTEMPTS } = {},
    ) {
        const disposition = this._circuitBreakerDisposition(context);

        if (disposition === 'reject') {
            const cbError = new Error(
                `Circuit breaker is open for "${context}". Service temporarily unavailable.`,
            );
            cbError.isCircuitBreakerOpen = true;
            cbError.status = 503;

            logger.warn({ context }, 'Asset issuer circuit breaker open, rejecting operation');
            if (fallback) {
                try {
                    return await fallback(cbError);
                } catch (fallbackError) {
                    logger.error({ err: fallbackError, context }, 'Asset issuer fallback handler failed while circuit breaker open');
                }
            }
            throw cbError;
        }

        const effectiveMaxAttempts = disposition === 'probe' ? 1 : maxAttempts;
        let lastError = null;

        for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt++) {
            try {
                const result = await this.withTimeout(
                    Promise.resolve().then(() => operation()),
                    timeoutMs,
                    context,
                );

                this._recordSuccess(context);
                return result;
            } catch (error) {
                lastError = error;
                const errorClass = this.classifyError(error);

                if (!errorClass.retryable || attempt === effectiveMaxAttempts) {
                    this._recordFailure(context, error);
                    const enhanced = this.enhanceError(error, context, attempt, errorClass);

                    if (!errorClass.retryable) {
                        this._pushToDeadLetterQueue({
                            context,
                            errorType: errorClass.type,
                            errorMessage: error.message,
                            attempts: attempt,
                        });
                    }

                    if (fallback) {
                        try {
                            return await fallback(enhanced);
                        } catch (fallbackError) {
                            logger.error({ err: fallbackError, context }, 'Asset issuer fallback handler failed');
                        }
                    }
                    throw enhanced;
                }

                const delay = this.calculateRetryDelay(attempt, errorClass.priority);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        this._recordFailure(context, lastError);
        const finalEnhanced = this.enhanceError(
            lastError,
            context,
            effectiveMaxAttempts,
            this.classifyError(lastError),
        );

        this._pushToDeadLetterQueue({
            context,
            errorType: this.classifyError(lastError).type,
            errorMessage: lastError?.message,
            attempts: effectiveMaxAttempts,
        });

        if (fallback) {
            try {
                return await fallback(finalEnhanced);
            } catch (fallbackError) {
                logger.error({ err: fallbackError, context }, 'Asset issuer fallback handler failed');
            }
        }
        throw finalEnhanced;
    }

    // ─── Error Classification ─────────────────────────────────────────────────

    static classifyError(error) {
        const message = error.message?.toLowerCase() || '';
        const status = error.status || error.response?.status;

        if (error.isTimeout || message.includes('timed out')) {
            return {
                type: 'timeout',
                retryable: true,
                priority: 'high',
                reason: 'Operation timed out',
            };
        }

        if (message.includes('index already exists') || message.includes('relation already exists')) {
            return {
                type: 'db_schema_conflict',
                retryable: false,
                priority: 'none',
                reason: 'Database schema conflict',
            };
        }

        if (
            message.includes('network') ||
            message.includes('timeout') ||
            message.includes('connection') ||
            message.includes('econnrefused') ||
            status === 502 ||
            status === 503 ||
            status === 504
        ) {
            return {
                type: 'network',
                retryable: true,
                priority: 'high',
                reason: 'Network connectivity issue',
            };
        }

        if (status === 429 || message.includes('rate limit')) {
            return {
                type: 'rate_limit',
                retryable: true,
                priority: 'low',
                reason: 'Rate limit exceeded',
            };
        }

        if (status === 401 || status === 403) {
            return {
                type: 'auth_error',
                retryable: false,
                priority: 'none',
                reason: 'Authentication or authorization failure',
            };
        }

        if (status >= 500 && status < 600) {
            return {
                type: 'server_error',
                retryable: true,
                priority: 'medium',
                reason: 'Server error',
            };
        }

        if (status === 404) {
            if (message.includes('issuer') || message.includes('asset')) {
                return {
                    type: 'asset_not_found',
                    retryable: false,
                    priority: 'none',
                    reason: 'Asset or issuer not found on the Stellar network',
                };
            }
            return {
                type: 'not_found',
                retryable: false,
                priority: 'none',
                reason: 'Resource not found',
            };
        }

        if (message.includes('invalid') || message.includes('malformed')) {
            return {
                type: 'validation_error',
                retryable: false,
                priority: 'none',
                reason: 'Invalid request parameters',
            };
        }

        if (status >= 400 && status < 500) {
            return {
                type: 'client_error',
                retryable: false,
                priority: 'none',
                reason: 'Client error',
            };
        }

        return {
            type: 'unknown',
            retryable: true,
            priority: 'low',
            reason: 'Unknown error type',
        };
    }

    // ─── Retry Delay ─────────────────────────────────────────────────────────────

    static calculateRetryDelay(attempt, priority = 'medium') {
        const multiplier = priority === 'high' ? 1 : priority === 'low' ? 3 : 2;
        const exponentialDelay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1) * multiplier;
        const jitter = exponentialDelay * 0.25 * (Math.random() - 0.5);
        return Math.min(exponentialDelay + jitter, 30000);
    }

    // ─── Error Enhancement ────────────────────────────────────────────────────────

    static enhanceError(originalError, context, attempts, errorClass) {
        const enhanced = new Error(
            `${context} failed after ${attempts} attempt${attempts !== 1 ? 's' : ''}: ${originalError.message} (${errorClass.reason})`,
        );
        enhanced.originalError = originalError;
        enhanced.context = context;
        enhanced.attempts = attempts;
        enhanced.errorClass = errorClass;
        enhanced.status = originalError.status || 500;
        enhanced.recoverable = errorClass.retryable;
        return enhanced;
    }

    // ─── Public Circuit-Breaker API ───────────────────────────────────────────────

    static isCircuitBreakerOpen(context = 'default') {
        return this._circuitBreakerDisposition(context) === 'reject';
    }

    static resetCircuitBreaker(context = null) {
        if (context) {
            circuitBreakerRegistry.delete(context);
        } else {
            circuitBreakerRegistry.clear();
        }
    }

    static getCircuitBreakerMetrics() {
        const snapshot = {};
        for (const [ctx, state] of circuitBreakerRegistry.entries()) {
            snapshot[ctx] = {
                state: state.state,
                failures: state.failures,
                lastFailureTime: state.lastFailureTime,
                metrics: { ...state.metrics },
            };
        }
        return snapshot;
    }

    /**
     * Issue #1052: single operational snapshot of the recovery subsystem.
     *
     * The per-context `getCircuitBreakerMetrics()` map is unbounded in shape
     * (one entry per context string) and the dead-letter queue is private, so
     * health endpoints had no cheap, bounded way to report how many contexts
     * are degraded or how much work is sitting unprocessed. This aggregates
     * both into fixed-shape counters.
     */
    static getRecoveryHealth() {
        let open = 0;
        let halfOpen = 0;
        let totalFailures = 0;
        let totalRecoveries = 0;

        for (const state of circuitBreakerRegistry.values()) {
            if (state.state === 'open') open += 1;
            if (state.state === 'half-open') halfOpen += 1;
            totalFailures += state.metrics.totalFailures;
            totalRecoveries += state.metrics.totalRecoveries;
        }

        return {
            trackedContexts: circuitBreakerRegistry.size,
            openCircuits: open,
            halfOpenCircuits: halfOpen,
            deadLetterQueueSize: deadLetterQueue.length,
            deadLetterQueueCapacity: DLQ_MAX_SIZE,
            totalFailures,
            totalRecoveries,
        };
    }

    static recordFailure() {
        this._recordFailure('default', new Error('Manual failure record'));
    }

    // ─── On-Chain Verification ─────────────────────────────────────────────────

    static async verifyIssuerOnChain(issuer) {
        return this.executeWithRecovery(
            async () => {
                const server = getHorizonServer();

                try {
                    await withHorizonRetry(
                        () => server.loadAccount(issuer),
                        `verify issuer ${issuer}`
                    );
                    return true;
                } catch (error) {
                    if (error.status === 404) {
                        return false;
                    }
                    throw error;
                }
            },
            "verify issuer on-chain",
            { timeoutMs: 20000 }
        );
    }
}

/**
 * Issue #887: Rate limiting for asset issuer operations
 *
 * Implements comprehensive rate limiting:
 * - Burst + standard two-tier rate limiting
 * - Per-merchant, per-API-key, per-IP rate limit keys
 * - SHA-256 hashed API keys for privacy
 * - Skip for premium/enterprise merchants
 * - Custom handler with logging and metrics
 * - Graceful degradation when Redis is unavailable
 */
export class AssetIssuerRateLimiter {

    /**
     * Issue #1052: the actor resolution (merchant → hashed API key → IP, with
     * a tier skip) was duplicated verbatim in `getKey`/`getBurstKey`, so the
     * two tiers could silently drift apart — e.g. a fix to the key hashing
     * applied to only one of them, leaving standard and burst buckets keyed
     * differently for the same caller.
     */
    static _resolveActor(req) {
        const merchantId = req?.merchant?.id;
        const apiKey = req?.headers?.["x-api-key"];
        const ipKey = ipKeyGenerator(req?.ip ?? req?.socket?.remoteAddress ?? "unknown-ip");

        // Issue #1314: the key was previously truncated to 16 hex chars
        // (64 bits), which is enough for an attacker to search for a
        // colliding prefix and share — or exhaust — a victim API key's
        // rate-limit bucket. Use the full SHA-256 digest.
        const hashedApiKey = apiKey
            ? createHash("sha256").update(apiKey).digest("hex")
            : null;

        return {
            actor: merchantId
                ? `merchant:${merchantId}`
                : hashedApiKey
                    ? `api:${hashedApiKey}`
                    : `ip:${ipKey}`,
            actorType: merchantId ? 'merchant' : hashedApiKey ? 'api_key' : 'ip',
        };
    }

    static _isExemptTier(req) {
        const merchantTier = req?.merchant?.metadata?.tier;
        return merchantTier === 'enterprise' || merchantTier === 'premium';
    }

    static getKey(req) {
        return `asset:issuer:${this._resolveActor(req).actor}`;
    }

    static getBurstKey(req) {
        return `asset:issuer:burst:${this._resolveActor(req).actor}`;
    }

    static createRateLimiter({ store } = {}) {
        return rateLimit({
            windowMs: ASSET_ISSUER_RATE_LIMIT_WINDOW_MS,
            max: ASSET_ISSUER_RATE_LIMIT_MAX,
            message: {
                error: "Too many asset issuer requests. Please slow down.",
                retryAfter: Math.ceil(ASSET_ISSUER_RATE_LIMIT_WINDOW_MS / 1000)
            },
            standardHeaders: true,
            legacyHeaders: false,
            keyGenerator: this.getKey,
            requestWasSuccessful: (_req, res) => res.statusCode < 400,
            handler: (req, res, _next, options) => {
                logger.warn({
                    endpoint: 'asset_issuer',
                    actorType: AssetIssuerRateLimiter._resolveActor(req).actorType,
                    ip: req.ip,
                    merchantId: req.merchant?.id,
                    limit: options.max,
                    windowMs: options.windowMs,
                }, 'Asset issuer rate limit exceeded');
                res.status(429).json(options.message);
            },
            store,
            passOnStoreError: true,
            skip: (req) => AssetIssuerRateLimiter._isExemptTier(req)
        });
    }

    static createBurstRateLimiter({ store } = {}) {
        return rateLimit({
            windowMs: ASSET_ISSUER_BURST_WINDOW_MS,
            max: ASSET_ISSUER_BURST_MAX,
            message: {
                error: "Burst of asset issuer requests detected. Please slow down.",
                retryAfter: Math.ceil(ASSET_ISSUER_BURST_WINDOW_MS / 1000)
            },
            standardHeaders: true,
            legacyHeaders: false,
            keyGenerator: this.getBurstKey,
            requestWasSuccessful: (_req, res) => res.statusCode < 400,
            handler: (req, res, _next, options) => {
                logger.warn({
                    endpoint: 'asset_issuer_burst',
                    actorType: AssetIssuerRateLimiter._resolveActor(req).actorType,
                    ip: req.ip,
                    merchantId: req.merchant?.id,
                    limit: options.max,
                    windowMs: options.windowMs,
                }, 'Asset issuer burst rate limit exceeded');
                res.status(429).json(options.message);
            },
            store,
            passOnStoreError: true,
            skip: (req) => AssetIssuerRateLimiter._isExemptTier(req)
        });
    }
}

/**
 * Issue #888: Cryptographic signature verification for asset operations
 *
 * Verifies transaction signatures with additional asset-issuer-specific checks:
 * - Operation type validation (payment, changeTrust, manageBuyOffer, etc.)
 * - Asset code and issuer extraction from transaction operations
 * - Multi-signature account support
 * - Verification result caching with TTL
 * - Enhanced error reporting with asset-specific context
 */
export class AssetIssuerSignatureVerifier {
    constructor() {
        this.verificationCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000;
        // Issue #1315: in-flight de-duplication. Without this, concurrent
        // callers verifying the same transaction (e.g. a webhook retry
        // racing the original request) would all miss the still-empty
        // cache, each kick off its own Horizon round trip, and each write
        // its own cache entry — wasted work and a window where the cache
        // could briefly hold a stale/inconsistent result.
        this.pendingVerifications = new Map();
    }

    async verifyOperation(txHash, options = {}) {
        const {
            expectedOperation = null,
            expectedAssetCode = null,
            expectedAssetIssuer = null,
            skipCache = false,
        } = typeof options === 'string' ? { expectedOperation: options } : (options ?? {});

        const cacheKey = `${txHash}:${expectedOperation || 'any'}:${expectedAssetCode || 'any'}:${expectedAssetIssuer || 'any'}`;

        if (!skipCache) {
            const cached = this.verificationCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.result;
            }
            if (cached) {
                // Issue #1312: drop expired entries instead of retaining them forever.
                this.verificationCache.delete(cacheKey);
            }

            const pending = this.pendingVerifications.get(cacheKey);
            if (pending) {
                return pending;
            }
        }

        const verificationPromise = this._runVerification(txHash, {
            expectedOperation,
            expectedAssetCode,
            expectedAssetIssuer,
            skipCache,
            cacheKey,
        });

        if (!skipCache) {
            this.pendingVerifications.set(cacheKey, verificationPromise);
        }

        try {
            return await verificationPromise;
        } finally {
            this.pendingVerifications.delete(cacheKey);
        }
    }

    async _runVerification(txHash, { expectedOperation, expectedAssetCode, expectedAssetIssuer, skipCache, cacheKey }) {
        return AssetIssuerErrorRecovery.executeWithRecovery(
            async () => {
                // Step 1: Basic signature verification
                const basicVerification = await verifyTransactionSignature(txHash);

                if (!basicVerification.valid) {
                    return {
                        ...basicVerification,
                        valid: false,
                        reason: `Basic signature verification failed: ${basicVerification.reason}`,
                        assetIssuerSpecific: false,
                    };
                }

                // Step 2: Operation-specific verification
                const operationVerification = await this.verifyAssetIssuerOperation(
                    txHash,
                    expectedOperation,
                    expectedAssetCode,
                    expectedAssetIssuer
                );

                const result = {
                    ...basicVerification,
                    valid: basicVerification.valid && operationVerification.valid,
                    reason: operationVerification.valid
                        ? `Asset issuer signature verification passed: ${basicVerification.reason}`
                        : `Asset issuer verification failed: ${operationVerification.reason}`,
                    assetIssuerSpecific: true,
                    operationType: operationVerification.operationType,
                    assetCode: operationVerification.assetCode,
                    assetIssuer: operationVerification.assetIssuer,
                    amount: operationVerification.amount,
                };

                if (!skipCache) {
                    if (this.verificationCache.size >= VERIFICATION_CACHE_MAX_ENTRIES) {
                        this.verificationCache.delete(this.verificationCache.keys().next().value);
                    }
                    this.verificationCache.set(cacheKey, {
                        result,
                        timestamp: Date.now()
                    });
                }

                return result;
            },
            "verify asset issuer operation"
        );
    }

    async verifyAssetIssuerOperation(txHash, expectedOperation, expectedAssetCode, expectedAssetIssuer) {
        const NETWORK = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
        const server = getHorizonServer();

        try {
            const tx = await withHorizonRetry(
                () => server.transactions().transaction(txHash).call(),
                `asset issuer transaction ${txHash}`
            );

            const passphrase = NETWORK === "public"
                ? StellarSdk.Networks.PUBLIC
                : StellarSdk.Networks.TESTNET;

            const transaction = new StellarSdk.Transaction(tx.envelope_xdr, passphrase);

            if (!transaction.operations || transaction.operations.length === 0) {
                return {
                    valid: false,
                    reason: "No operations found in transaction",
                };
            }

            const relevantOperations = transaction.operations.filter(op =>
                op.type === 'payment' ||
                op.type === 'changeTrust' ||
                op.type === 'manageBuyOffer' ||
                op.type === 'manageSellOffer' ||
                op.type === 'createPassiveSellOffer' ||
                op.type === 'claimClaimableBalance' ||
                op.type === 'pathPaymentStrictReceive' ||
                op.type === 'pathPaymentStrictSend'
            );

            if (relevantOperations.length === 0) {
                return {
                    valid: false,
                    reason: "No asset-related operations found in transaction",
                };
            }

            const op = relevantOperations[0];

            if (expectedOperation && op.type !== expectedOperation) {
                return {
                    valid: false,
                    reason: `Operation type mismatch. Expected: ${expectedOperation}, Found: ${op.type}`,
                };
            }

            let assetCode = null;
            let assetIssuer = null;
            let amount = null;

            const extractAsset = (asset) => {
                if (!asset || asset.isNative()) {
                    return { code: 'XLM', issuer: null };
                }
                const code = asset.getCode();
                const issuer = asset.getIssuer();
                if (!isValidAssetCode(code)) {
                    throw new Error(`Invalid asset code in operation: ${code}`);
                }
                if (!isValidStellarPublicKey(issuer)) {
                    throw new Error(`Invalid asset issuer in operation: ${issuer}`);
                }
                return { code, issuer };
            };

            if (op.type === 'payment') {
                const assetInfo = extractAsset(op.asset);
                assetCode = assetInfo.code;
                assetIssuer = assetInfo.issuer;
                amount = op.amount;
            } else if (op.type === 'changeTrust') {
                const assetInfo = extractAsset(op.asset);
                assetCode = assetInfo.code;
                assetIssuer = assetInfo.issuer;
                if (assetCode === 'XLM') {
                    return {
                        valid: false,
                        reason: "Native asset trustlines are not allowed",
                    };
                }
            } else if (op.type === 'manageBuyOffer' || op.type === 'manageSellOffer') {
                const selling = extractAsset(op.selling);
                const buying = extractAsset(op.buying);
                assetCode = buying.code;
                assetIssuer = buying.issuer || selling.issuer;
                amount = op.amount;
            } else if (op.type === 'pathPaymentStrictReceive' || op.type === 'pathPaymentStrictSend') {
                const destAsset = extractAsset(op.destAsset || op.destination_asset);
                assetCode = destAsset.code;
                assetIssuer = destAsset.issuer;
                amount = op.destAmount || op.destination_amount || op.destMin || op.destination_min;
            }

            if (expectedAssetCode && assetCode !== expectedAssetCode) {
                return {
                    valid: false,
                    reason: `Asset code mismatch. Expected: ${expectedAssetCode}, Found: ${assetCode}`,
                    operationType: op.type,
                    assetCode,
                    assetIssuer,
                    amount,
                };
            }

            if (expectedAssetIssuer && assetIssuer !== expectedAssetIssuer) {
                return {
                    valid: false,
                    reason: `Asset issuer mismatch. Expected: ${expectedAssetIssuer}, Found: ${assetIssuer}`,
                    operationType: op.type,
                    assetCode,
                    assetIssuer,
                    amount,
                };
            }

            return {
                valid: true,
                reason: `Valid ${op.type} operation found`,
                operationType: op.type,
                assetCode,
                assetIssuer,
                amount,
            };

        } catch (error) {
            logger.warn({ err: error, txHash }, 'Asset issuer operation verification failed');
            return {
                valid: false,
                reason: `Failed to verify asset issuer operation: ${error.message}`,
                operationType: null,
                assetCode: null,
                assetIssuer: null,
                amount: null,
            };
        }
    }

    clearCache() {
        this.verificationCache.clear();
    }
}

/**
 * Issue #889: Optimized SQL queries for asset and issuer data
 *
 * Provides optimized database queries:
 * - Efficient issuer statistics with aggregation
 * - Filtered payment queries by asset and issuer with pagination
 * - Issuer validation against merchant's allowed issuers
 * - Payment limit validation per asset
 * - Health metrics for asset issuer monitoring
 * - Optimized index creation for query performance
 */
export class AssetIssuerQueryOptimizer {

    static async getIssuerStats(issuer, { skipCache = false } = {}) {
        const cacheKey = `issuer_stats:${issuer}`;
        if (!skipCache) {
            const cached = issuerQueryCache.get(cacheKey);
            if (cached !== undefined) {
                return cached;
            }
        }

        const query = `
      SELECT
        asset,
        COUNT(*) as payment_count,
        SUM(amount) as total_volume,
        AVG(amount) as avg_amount,
        MAX(created_at) as last_activity,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
      FROM payments
      WHERE asset_issuer = $1
        AND deleted_at IS NULL
      GROUP BY asset
      ORDER BY total_volume DESC
    `;

        const result = await AssetIssuerErrorRecovery.executeWithRecovery(
            () => queryWithRetry(query, [issuer]),
            `get stats for issuer ${issuer}`
        );

        if (!skipCache) {
            issuerQueryCache.set(cacheKey, result);
        }

        return result;
    }

    static async findPaymentsByAssetAndIssuer(assetCode, assetIssuer, options = {}) {
        const {
            status = null,
            limit = 50,
            offset = 0,
            dateFrom = null,
            dateTo = null,
            merchantId = null,
        } = options;

        let whereConditions = [
            'p.deleted_at IS NULL',
        ];
        let params = [];
        let paramIndex = 1;

        if (merchantId) {
            whereConditions.push(`p.merchant_id = $${paramIndex}`);
            params.push(merchantId);
            paramIndex++;
        }

        if (assetCode) {
            whereConditions.push(`p.asset = $${paramIndex}`);
            params.push(assetCode);
            paramIndex++;
        }

        if (assetIssuer !== null && assetIssuer !== undefined) {
            if (assetIssuer === '') {
                whereConditions.push('p.asset_issuer IS NULL');
            } else {
                whereConditions.push(`p.asset_issuer = $${paramIndex}`);
                params.push(assetIssuer);
                paramIndex++;
            }
        }

        if (status) {
            whereConditions.push(`p.status = $${paramIndex}`);
            params.push(status);
            paramIndex++;
        }

        if (dateFrom) {
            whereConditions.push(`p.created_at >= $${paramIndex}`);
            params.push(dateFrom);
            paramIndex++;
        }

        if (dateTo) {
            whereConditions.push(`p.created_at <= $${paramIndex}`);
            params.push(dateTo);
            paramIndex++;
        }

        const query = `
      SELECT
        p.id, p.client_id, p.amount, p.asset, p.asset_issuer,
        p.recipient, p.status, p.tx_id, p.memo,
        p.created_at, p.completion_duration_seconds,
        p.metadata
      FROM payments p
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

        params.push(limit, offset);

        return AssetIssuerErrorRecovery.executeWithRecovery(
            () => queryWithRetry(query, params),
            `find payments for asset ${assetCode} by issuer ${assetIssuer}`
        );
    }

    static async validateIssuerAgainstMerchant(merchantId, assetCode, assetIssuer) {
        const query = `
      SELECT
        m.id,
        m.allowed_issuers,
        m.payment_limits,
        CASE
          WHEN m.allowed_issuers IS NULL
            OR jsonb_array_length(m.allowed_issuers) = 0
            OR m.allowed_issuers ? $2
          THEN true
          ELSE false
        END as issuer_allowed
      FROM merchants m
      WHERE m.id = $1
        AND m.deleted_at IS NULL
    `;

        return AssetIssuerErrorRecovery.executeWithRecovery(
            () => queryWithRetry(query, [merchantId, assetIssuer]),
            `validate issuer ${assetIssuer} for merchant ${merchantId}`
        );
    }

    static async validatePaymentLimits(merchantId, assetCode, amount) {
        const query = `
      SELECT
        payment_limits->>$2 as asset_limit_min,
        payment_limits->>$3 as asset_limit_max
      FROM merchants
      WHERE id = $1 AND deleted_at IS NULL
    `;

        return AssetIssuerErrorRecovery.executeWithRecovery(
            () => queryWithRetry(query, [merchantId, `${assetCode}.min`, `${assetCode}.max`]),
            `validate payment limits for ${assetCode} for merchant ${merchantId}`
        );
    }

    static async getAssetIssuerHealthMetrics(merchantId, { skipCache = false } = {}) {
        const cacheKey = `health_metrics:${merchantId}`;
        if (!skipCache) {
            const cached = issuerQueryCache.get(cacheKey);
            if (cached !== undefined) {
                return cached;
            }
        }

        const query = `
      WITH asset_stats AS (
        SELECT
          p.asset,
          p.asset_issuer,
          COUNT(*) as total_payments,
          COUNT(CASE WHEN p.status = 'failed' THEN 1 END) as failed_payments,
          AVG(CASE WHEN p.completion_duration_seconds IS NOT NULL
              THEN p.completion_duration_seconds END) as avg_completion_time,
          SUM(p.amount) as total_volume
        FROM payments p
        WHERE p.merchant_id = $1
          AND p.deleted_at IS NULL
          AND p.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY p.asset, p.asset_issuer
      ),
      merchant_config AS (
        SELECT
          m.allowed_issuers,
          m.payment_limits,
          jsonb_array_length(COALESCE(m.allowed_issuers, '[]'::jsonb)) as issuer_count
        FROM merchants m
        WHERE m.id = $1
          AND m.deleted_at IS NULL
      )
      SELECT
        a.*,
        CASE
          WHEN a.total_payments > 0
          THEN ROUND((a.failed_payments::numeric / a.total_payments::numeric) * 100, 2)
          ELSE 0
        END as failure_rate_percent,
        m.issuer_count,
        CASE
          WHEN m.allowed_issuers IS NULL OR jsonb_array_length(m.allowed_issuers) = 0
          THEN true
          ELSE (m.allowed_issuers ? a.asset_issuer OR a.asset = 'XLM')
        END as issuer_allowed
      FROM asset_stats a
      CROSS JOIN merchant_config m
      ORDER BY a.total_volume DESC
    `;

        const result = await AssetIssuerErrorRecovery.executeWithRecovery(
            () => queryWithRetry(query, [merchantId]),
            `get asset issuer health metrics for merchant ${merchantId}`
        );

        if (!skipCache) {
            issuerQueryCache.set(cacheKey, result);
        }

        return result;
    }

    static async logAssetIssuerVerification({ merchantId, txHash, verification, assetCode, assetIssuer } = {}) {
        // Issue #1313: `verification` was dereferenced unconditionally, so a
        // missing verification result threw a null pointer exception.
        if (!verification) {
            throw new TypeError('logAssetIssuerVerification requires a verification result');
        }
        const query = `
      INSERT INTO asset_issuer_verifications (
        merchant_id,
        asset_code,
        asset_issuer,
        is_valid,
        verification_type,
        reason,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, created_at
    `;

        const params = [
            merchantId,
            assetCode || verification.assetCode || null,
            assetIssuer || verification.assetIssuer || null,
            verification.valid,
            verification.operationType || 'signature_verification',
            verification.reason || null,
            JSON.stringify({
                txHash,
                isMultiSig: verification.isMultiSig || false,
                signatureCount: verification.signatureCount || 0,
                thresholdMet: verification.thresholdMet || false,
                timestamp: new Date().toISOString()
            })
        ];

        const result = await AssetIssuerErrorRecovery.executeWithRecovery(
            () => queryWithRetry(query, params),
            `log asset issuer verification for merchant ${merchantId}`
        );

        // Issue #1050: a new verification changes this issuer's stats and this
        // merchant's health rollup, so drop both cached reads. Bounded to the
        // keys this write can actually affect.
        AssetIssuerQueryOptimizer.invalidateQueryCache({
            assetIssuer: assetIssuer || verification.assetIssuer,
            merchantId,
        });

        return result;
    }

    // ─── Query Cache (Issue #1050) ───────────────────────────────────────────────

    /**
     * Drop the cached reads that a verification write makes stale. Call with no
     * arguments to clear the whole cache; with `{ assetIssuer }` and/or
     * `{ merchantId }` to drop only those keys. A call that names neither key
     * but passes an options object is a no-op, so a write with no known
     * issuer/merchant cannot wipe the cache for everyone.
     */
    static invalidateQueryCache(options) {
        if (options === undefined) {
            const size = issuerQueryCache.getStats().size;
            issuerQueryCache.clear();
            return size;
        }

        const { assetIssuer, merchantId } = options;
        let removed = 0;
        if (merchantId) {
            if (issuerQueryCache.delete(`health_metrics:${merchantId}`)) removed++;
        }
        if (assetIssuer) {
            if (issuerQueryCache.delete(`issuer_stats:${assetIssuer}`)) removed++;
        }
        return removed;
    }

    static getQueryCacheStats() {
        return issuerQueryCache.getStats();
    }

    static async createOptimizedIndexes() {
        const indexes = [
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_asset_issuer_status
             ON payments(asset_issuer, status, created_at DESC)
             WHERE deleted_at IS NULL AND asset_issuer IS NOT NULL`,

            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_merchant_asset_issuer
             ON payments(merchant_id, asset, asset_issuer, created_at DESC)
             WHERE deleted_at IS NULL`,

            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_issuer_volume
             ON payments(asset_issuer, amount DESC)
             WHERE deleted_at IS NULL AND asset_issuer IS NOT NULL AND status = 'confirmed'`,

            `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_allowed_issuers_gin
             ON merchants USING GIN(allowed_issuers)
             WHERE deleted_at IS NULL`,
        ];

        const results = [];
        for (const indexQuery of indexes) {
            try {
                await AssetIssuerErrorRecovery.executeWithRecovery(
                    () => queryWithRetry(indexQuery, []),
                    `create index: ${indexQuery.split(' ')[5]}`
                );
                results.push({ success: true, query: indexQuery });
            } catch (error) {
                if (error.errorClass?.type === 'network') {
                    throw error;
                }
                results.push({ success: false, query: indexQuery, error: error.message });
            }
        }

        return results;
    }
}

/**
 * Main Asset Issuer Manager that orchestrates all components
 */
export class AssetIssuerManager {
    constructor() {
        this.signatureVerifier = new AssetIssuerSignatureVerifier();
        this.rateLimiter = AssetIssuerRateLimiter;
        this.errorRecovery = AssetIssuerErrorRecovery;
        this.queryOptimizer = AssetIssuerQueryOptimizer;
    }

    async verifyAssetIssuerTransaction(txHash, options = {}) {
        const {
            expectedOperation = null,
            expectedAssetCode = null,
            expectedAssetIssuer = null,
            skipCache = false,
        } = options ?? {};

        return this.errorRecovery.executeWithRecovery(
            () => this.signatureVerifier.verifyOperation(txHash, {
                expectedOperation,
                expectedAssetCode,
                expectedAssetIssuer,
                skipCache,
            }),
            `verify asset issuer transaction ${txHash}`
        );
    }

    async getMerchantIssuerConfig(merchantId) {
        const [healthMetrics, cbMetrics] = await Promise.all([
            this.queryOptimizer.getAssetIssuerHealthMetrics(merchantId),
            Promise.resolve(this.errorRecovery.getCircuitBreakerMetrics()),
        ]);

        return {
            healthMetrics: healthMetrics.rows || [],
            circuitBreakers: cbMetrics,
            timestamp: new Date().toISOString(),
        };
    }

    async initialize() {
        try {
            const indexResults = await this.queryOptimizer.createOptimizedIndexes();
            logger.info('Asset Issuer Manager initialized with database optimizations');
            return { success: true, indexResults };
        } catch (error) {
            logger.error('Failed to initialize Asset Issuer Manager:', error);
            return { success: false, error: error.message };
        }
    }

    getCircuitBreakerMetrics() {
        return this.errorRecovery.getCircuitBreakerMetrics();
    }

    getDeadLetterQueue() {
        return this.errorRecovery.getDeadLetterQueue();
    }

    getQueryCacheStats() {
        return this.queryOptimizer.getQueryCacheStats();
    }

    invalidateQueryCache(options) {
        return this.queryOptimizer.invalidateQueryCache(options);
    }
}

export const assetIssuerManager = new AssetIssuerManager();

export function createAssetIssuerRateLimits(redisClient) {
    const store = createRedisRateLimitStore({
        client: redisClient,
        prefix: `${RATE_LIMIT_REDIS_PREFIX}asset:issuer:`
    });

    return {
        standard: AssetIssuerRateLimiter.createRateLimiter({ store }),
        burst: AssetIssuerRateLimiter.createBurstRateLimiter({ store }),
    };
}
