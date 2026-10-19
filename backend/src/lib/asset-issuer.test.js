/**
 * Comprehensive test suite for Asset Issuer Service
 * Tests all four optimization tasks:
 * - Issue #890: Error recovery
 * - Issue #887: Rate limiting
 * - Issue #888: Signature verification
 * - Issue #889: SQL optimization
 */

import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';
const {
    mockQueryWithRetry,
    mockVerifyTransactionSignature,
    mockWithHorizonRetry,
    mockStellarServer,
    mockRateLimit,
    mockIpKeyGenerator,
    mockLogger,
} = vi.hoisted(() => ({
    mockQueryWithRetry: vi.fn(),
    mockVerifyTransactionSignature: vi.fn(),
    mockWithHorizonRetry: vi.fn(),
    mockStellarServer: vi.fn().mockImplementation(() => ({
        loadAccount: vi.fn(),
        transactions: vi.fn().mockReturnThis(),
        transaction: vi.fn().mockReturnThis(),
        call: vi.fn(),
    })),
    mockRateLimit: vi.fn(() => (req, res, next) => next()),
    mockIpKeyGenerator: vi.fn(),
    mockLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('./db.js', () => ({ queryWithRetry: mockQueryWithRetry }));
vi.mock('./stellar.js', () => ({
    verifyTransactionSignature: mockVerifyTransactionSignature,
    withHorizonRetry: mockWithHorizonRetry,
    isValidStellarAccountId: vi.fn().mockReturnValue(true),
    isValidAssetCode: vi.fn().mockReturnValue(true),
    isValidStellarPublicKey: vi.fn().mockReturnValue(true),
}));
vi.mock('stellar-sdk', () => ({
    Horizon: { Server: mockStellarServer },
    Networks: { PUBLIC: 'public', TESTNET: 'testnet' },
    Transaction: vi.fn().mockImplementation(() => ({
        operations: [],
        signatures: [],
    })),
    Keypair: {
        fromPublicKey: vi.fn().mockReturnValue({
            verify: vi.fn().mockReturnValue(true),
        }),
    },
}));
vi.mock('express-rate-limit', () => ({ default: mockRateLimit, ipKeyGenerator: mockIpKeyGenerator }));
vi.mock('./logger.js', () => ({ logger: mockLogger }));
vi.mock('./metrics.js', () => ({
    assetIssuerVerificationsTotal: { inc: vi.fn() },
    assetIssuerVerificationDuration: { observe: vi.fn() },
    assetIssuerCacheOperationsTotal: { inc: vi.fn() },
    assetIssuerCacheSize: { set: vi.fn() },
    assetIssuerQueryDuration: { observe: vi.fn() },
    assetIssuerErrorRecoveryTotal: { inc: vi.fn() },
    assetIssuerCircuitBreakerState: { set: vi.fn() },
    assetIssuerOpenCircuitBreakers: { set: vi.fn() },
    assetIssuerDeadLetterQueueSize: { set: vi.fn() },
}));
vi.mock('./rate-limit.js', () => ({
    createRedisRateLimitStore: vi.fn(),
    RATE_LIMIT_REDIS_PREFIX: 'rl:',
}));

import {
    AssetIssuerErrorRecovery,
    AssetIssuerRateLimiter,
    AssetIssuerSignatureVerifier,
    AssetIssuerQueryOptimizer,
    AssetIssuerManager,
    assetIssuerManager,
    createAssetIssuerRateLimits,
} from './asset-issuer.js';
import { queryWithRetry } from './db.js';
import { withHorizonRetry } from './stellar.js';
import {
    assetIssuerVerificationsTotal,
    assetIssuerCacheOperationsTotal,
    assetIssuerQueryDuration,
    assetIssuerErrorRecoveryTotal,
    assetIssuerCircuitBreakerState,
    assetIssuerOpenCircuitBreakers,
    assetIssuerDeadLetterQueueSize,
    assetIssuerCacheSize,
} from './metrics.js';

// ============================================================================
// Issue #890: Enhanced Error Recovery
// ============================================================================
describe('AssetIssuerErrorRecovery (Issue #890)', () => {
    beforeEach(() => {
        AssetIssuerErrorRecovery.resetCircuitBreaker();
        vi.clearAllMocks();
    });

    describe('executeWithRecovery', () => {
        test('should execute operation successfully on first try', async () => {
            const mockOperation = vi.fn().mockResolvedValue('success');
            const result = await AssetIssuerErrorRecovery.executeWithRecovery(mockOperation);
            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        test('should retry on retryable network errors', async () => {
            const mockOperation = vi.fn()
                .mockRejectedValueOnce(new Error('network timeout'))
                .mockResolvedValue('success');

            const result = await AssetIssuerErrorRecovery.executeWithRecovery(mockOperation);
            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledTimes(2);
        }, 30000);

        test('should retry up to MAX_RETRY_ATTEMPTS then fail', async () => {
            const mockOperation = vi.fn().mockRejectedValue(new Error('network error'));
            await expect(
                AssetIssuerErrorRecovery.executeWithRecovery(mockOperation)
            ).rejects.toThrow('network error');
            expect(mockOperation).toHaveBeenCalledTimes(3);
        }, 30000);

        test('should not retry non-retryable client errors (4xx)', async () => {
            const error = new Error('bad request');
            error.status = 400;
            const mockOperation = vi.fn().mockRejectedValue(error);
            await expect(
                AssetIssuerErrorRecovery.executeWithRecovery(mockOperation)
            ).rejects.toThrow('bad request');
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        test('should not retry auth errors (401, 403)', async () => {
            const error = new Error('unauthorized');
            error.status = 401;
            const mockOperation = vi.fn().mockRejectedValue(error);
            await expect(
                AssetIssuerErrorRecovery.executeWithRecovery(mockOperation)
            ).rejects.toThrow('unauthorized');
            expect(mockOperation).toHaveBeenCalledTimes(1);
        });

        test('should throw immediately when circuit breaker is open (using non-retryable errors)', async () => {
            const error = new Error('bad request');
            error.status = 400;
            const mockOperation = vi.fn().mockRejectedValue(error);

            // Non-retryable errors fail immediately without retries
            // so we can quickly reach the circuit breaker threshold
            for (let i = 0; i < 5; i++) {
                await expect(
                    AssetIssuerErrorRecovery.executeWithRecovery(mockOperation, 'cb_test')
                ).rejects.toThrow('bad request');
            }

            await expect(
                AssetIssuerErrorRecovery.executeWithRecovery(mockOperation, 'cb_test')
            ).rejects.toThrow('Circuit breaker is open');
        });

        test('circuit breaker should be per-context isolated', async () => {
            const error = new Error('bad request');
            error.status = 400;
            const failingOp = vi.fn().mockRejectedValue(error);
            const succeedingOp = vi.fn().mockResolvedValue('ok');

            for (let i = 0; i < 5; i++) {
                await expect(
                    AssetIssuerErrorRecovery.executeWithRecovery(failingOp, 'context_a')
                ).rejects.toThrow();
            }

            const result = await AssetIssuerErrorRecovery.executeWithRecovery(succeedingOp, 'context_b');
            expect(result).toBe('ok');
        });

        test('should invoke fallback for non-retryable errors', async () => {
            const error = new Error('bad request');
            error.status = 400;
            const mockOperation = vi.fn().mockRejectedValue(error);
            const fallback = vi.fn().mockResolvedValue('fallback_result');

            const result = await AssetIssuerErrorRecovery.executeWithRecovery(
                mockOperation,
                'test context',
                { fallback }
            );
            expect(result).toBe('fallback_result');
        });

        test('should invoke fallback after retries exhausted for retryable errors', async () => {
            const mockOperation = vi.fn().mockRejectedValue(new Error('network error'));
            const fallback = vi.fn().mockResolvedValue('fallback_result');

            const promise = AssetIssuerErrorRecovery.executeWithRecovery(
                mockOperation,
                'test context',
                { fallback }
            );
            const result = await promise;
            expect(result).toBe('fallback_result');
        }, 30000);

        test('should timeout long-running operations', async () => {
            const slowOp = vi.fn().mockImplementation(
                () => new Promise(resolve => setTimeout(resolve, 500))
            );
            await expect(
                AssetIssuerErrorRecovery.executeWithRecovery(slowOp, 'test', { timeoutMs: 50 })
            ).rejects.toThrow('timed out');
        }, 30000);
    });

    describe('error classification', () => {
        test('should classify network errors as retryable high priority', () => {
            const result = AssetIssuerErrorRecovery.classifyError(new Error('network timeout'));
            expect(result.retryable).toBe(true);
            expect(result.priority).toBe('high');
        });

        test('should classify 429 rate limit as retryable low priority', () => {
            const error = new Error('rate limit');
            error.status = 429;
            const result = AssetIssuerErrorRecovery.classifyError(error);
            expect(result.retryable).toBe(true);
            expect(result.priority).toBe('low');
        });

        test('should classify 503 server error as retryable with correct type', () => {
            const error = new Error('internal error');
            error.status = 503;
            const result = AssetIssuerErrorRecovery.classifyError(error);
            expect(result.retryable).toBe(true);
            expect(result.type).toBe('network');
        });

        test('should classify 404 with asset context as asset_not_found', () => {
            const error = new Error('asset issuer not found');
            error.status = 404;
            const result = AssetIssuerErrorRecovery.classifyError(error);
            expect(result.retryable).toBe(false);
            expect(result.type).toBe('asset_not_found');
        });

        test('should classify generic 404 as not_found', () => {
            const error = new Error('not found');
            error.status = 404;
            const result = AssetIssuerErrorRecovery.classifyError(error);
            expect(result.retryable).toBe(false);
            expect(result.type).toBe('not_found');
        });

        test('should classify timeout errors', () => {
            const error = new Error('timed out');
            error.isTimeout = true;
            const result = AssetIssuerErrorRecovery.classifyError(error);
            expect(result.retryable).toBe(true);
            expect(result.priority).toBe('high');
        });

        test('should classify validation errors as non-retryable', () => {
            const result = AssetIssuerErrorRecovery.classifyError(new Error('Invalid asset issuer'));
            expect(result.retryable).toBe(false);
            expect(result.type).toBe('validation_error');
        });
    });

    describe('dead letter queue', () => {
        test('should push failed operations to DLQ', async () => {
            const error = new Error('bad request');
            error.status = 400;
            const mockOperation = vi.fn().mockRejectedValue(error);

            await expect(
                AssetIssuerErrorRecovery.executeWithRecovery(mockOperation, 'dlq_test')
            ).rejects.toThrow();

            const dlq = AssetIssuerErrorRecovery.getDeadLetterQueue();
            expect(dlq.length).toBeGreaterThan(0);
            expect(dlq[dlq.length - 1].context).toBe('dlq_test');
        });

        test('should log when an operation is dead-lettered', async () => {
            AssetIssuerErrorRecovery.drainDeadLetterQueue();
            const error = new Error('bad request');
            error.status = 400;
            const mockOperation = vi.fn().mockRejectedValue(error);

            await expect(
                AssetIssuerErrorRecovery.executeWithRecovery(mockOperation, 'dlq_logging_test')
            ).rejects.toThrow();

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.objectContaining({ context: 'dlq_logging_test' }),
                'Asset issuer operation added to dead-letter queue'
            );
        });

        test('should evict the oldest entry and log once the queue is full', async () => {
            AssetIssuerErrorRecovery.drainDeadLetterQueue();

            const failing = (context) => {
                const error = new Error('bad request');
                error.status = 400;
                return expect(
                    AssetIssuerErrorRecovery.executeWithRecovery(vi.fn().mockRejectedValue(error), context)
                ).rejects.toThrow();
            };

            for (let i = 0; i < 100; i += 1) {
                await failing(`dlq_fill_${i}`);
            }

            const dlq = AssetIssuerErrorRecovery.getDeadLetterQueue();
            expect(dlq.length).toBe(100);
            expect(dlq[0].context).toBe('dlq_fill_0');

            await failing('dlq_overflow');

            const afterOverflow = AssetIssuerErrorRecovery.getDeadLetterQueue();
            expect(afterOverflow.length).toBe(100);
            expect(afterOverflow[0].context).toBe('dlq_fill_1');
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.objectContaining({ context: 'dlq_fill_0' }),
                'Asset issuer dead-letter queue full, evicted oldest entry'
            );

            AssetIssuerErrorRecovery.drainDeadLetterQueue();
        }, 60000);

        test('should drain dead letter queue', () => {
            const drained = AssetIssuerErrorRecovery.drainDeadLetterQueue();
            expect(Array.isArray(drained)).toBe(true);
            expect(AssetIssuerErrorRecovery.getDeadLetterQueue().length).toBe(0);
        });
    });

    describe('recovery health snapshot (Issue #1052)', () => {
        test('should report a bounded, fixed-shape snapshot', () => {
            AssetIssuerErrorRecovery.drainDeadLetterQueue();
            const health = AssetIssuerErrorRecovery.getRecoveryHealth();

            expect(health).toEqual({
                trackedContexts: expect.any(Number),
                openCircuits: expect.any(Number),
                halfOpenCircuits: expect.any(Number),
                deadLetterQueueSize: expect.any(Number),
                deadLetterQueueCapacity: expect.any(Number),
                totalFailures: expect.any(Number),
                totalRecoveries: expect.any(Number),
            });
        });

        test('should count open circuits and dead-lettered work', async () => {
            AssetIssuerErrorRecovery.drainDeadLetterQueue();
            const error = new Error('bad request');
            error.status = 400;

            for (let i = 0; i < 5; i += 1) {
                await expect(
                    AssetIssuerErrorRecovery.executeWithRecovery(
                        vi.fn().mockRejectedValue(error),
                        'health_open_context'
                    )
                ).rejects.toThrow();
            }

            const health = AssetIssuerErrorRecovery.getRecoveryHealth();
            expect(health.openCircuits).toBe(1);
            expect(health.halfOpenCircuits).toBe(0);
            expect(health.deadLetterQueueSize).toBe(5);
            expect(health.totalFailures).toBeGreaterThanOrEqual(5);
        });
    });

    describe('calculateRetryDelay', () => {
        test('should return increasing delays with jitter', () => {
            const delay1 = AssetIssuerErrorRecovery.calculateRetryDelay(1, 'high');
            const delay2 = AssetIssuerErrorRecovery.calculateRetryDelay(2, 'high');
            expect(delay2).toBeGreaterThan(delay1);
            expect(delay1).toBeGreaterThan(0);
            expect(delay2).toBeLessThanOrEqual(30000);
        });
    });

    describe('verifyIssuerOnChain', () => {
        test('should verify issuer existence on-chain', async () => {
            mockWithHorizonRetry.mockResolvedValue({ id: 'GBXX' });
            const result = await AssetIssuerErrorRecovery.verifyIssuerOnChain('GBXX');
            expect(result).toBe(true);
        });

        test('should reuse a single Horizon client across verifications (Issue #1052)', async () => {
            mockWithHorizonRetry.mockResolvedValue({ id: 'GBXX' });

            await AssetIssuerErrorRecovery.verifyIssuerOnChain('GBXX');
            const constructionsAfterFirst = mockStellarServer.mock.calls.length;

            await AssetIssuerErrorRecovery.verifyIssuerOnChain('GBXX');
            expect(mockStellarServer.mock.calls.length).toBe(constructionsAfterFirst);
        });

        test('should return false if issuer not found (404)', async () => {
            const error = new Error('not found');
            error.status = 404;
            mockWithHorizonRetry.mockRejectedValue(error);
            const result = await AssetIssuerErrorRecovery.verifyIssuerOnChain('GBXX');
            expect(result).toBe(false);
        });
    });

    describe('circuit breaker metrics', () => {
        test('should return circuit breaker metrics snapshot', () => {
            const metrics = AssetIssuerErrorRecovery.getCircuitBreakerMetrics();
            expect(typeof metrics).toBe('object');
        });
    });

    describe('open circuit handling (Issue #1052)', () => {
        test('should log the rejection and a failing fallback handler', async () => {
            const error = new Error('bad request');
            error.status = 400;

            for (let i = 0; i < 5; i += 1) {
                await expect(
                    AssetIssuerErrorRecovery.executeWithRecovery(
                        vi.fn().mockRejectedValue(error),
                        'open_circuit_context'
                    )
                ).rejects.toThrow();
            }

            const fallback = vi.fn().mockRejectedValue(new Error('fallback exploded'));

            await expect(
                AssetIssuerErrorRecovery.executeWithRecovery(
                    vi.fn().mockResolvedValue('never reached'),
                    'open_circuit_context',
                    { fallback }
                )
            ).rejects.toThrow('Circuit breaker is open');

            expect(mockLogger.warn).toHaveBeenCalledWith(
                { context: 'open_circuit_context' },
                'Asset issuer circuit breaker open, rejecting operation'
            );
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({ context: 'open_circuit_context' }),
                'Asset issuer fallback handler failed while circuit breaker open'
            );
        });

        test('should return the fallback result when the handler succeeds', async () => {
            const error = new Error('bad request');
            error.status = 400;

            for (let i = 0; i < 5; i += 1) {
                await expect(
                    AssetIssuerErrorRecovery.executeWithRecovery(
                        vi.fn().mockRejectedValue(error),
                        'open_circuit_fallback_ok'
                    )
                ).rejects.toThrow();
            }

            const fallback = vi.fn().mockResolvedValue('degraded-response');

            await expect(
                AssetIssuerErrorRecovery.executeWithRecovery(
                    vi.fn().mockResolvedValue('never reached'),
                    'open_circuit_fallback_ok',
                    { fallback }
                )
            ).resolves.toBe('degraded-response');

            expect(mockLogger.error).not.toHaveBeenCalled();
        });
    });
});

// ============================================================================
// Issue #887: Rate Limiting
// ============================================================================
describe('AssetIssuerRateLimiter (Issue #887)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getKey', () => {
        test('should generate key using merchant ID when available', () => {
            const req = { merchant: { id: 'M1' } };
            const key = AssetIssuerRateLimiter.getKey(req);
            expect(key).toBe('asset:issuer:merchant:M1');
        });

        test('should generate key using API key hash when no merchant', () => {
            const req = {
                headers: { 'x-api-key': 'sk_test_1234567890abcdef' },
                ip: '1.2.3.4',
            };
            const key = AssetIssuerRateLimiter.getKey(req);
            // Issue #1314: full SHA-256 digest (64 hex chars), not a
            // truncated 16-char prefix — a short prefix is brute-forceable,
            // letting an attacker collide with and share/exhaust another
            // API key's rate-limit bucket.
            expect(key).toMatch(/^asset:issuer:api:[a-f0-9]{64}$/);
        });

        test('should not truncate the API key hash (Issue #1314)', () => {
            const req = { headers: { 'x-api-key': 'sk_live_abc' }, ip: '5.6.7.8' };
            const key = AssetIssuerRateLimiter.getKey(req);
            const hash = key.replace('asset:issuer:api:', '');
            expect(hash).toHaveLength(64);
        });

        test('should use IP fallback when no merchant or API key', () => {
            const req = { ip: '1.2.3.4' };
            mockIpKeyGenerator.mockReturnValue('1.2.3.4');
            const key = AssetIssuerRateLimiter.getKey(req);
            expect(key).toBe('asset:issuer:ip:1.2.3.4');
        });
    });

    describe('getBurstKey', () => {
        test('should generate burst key with burst prefix', () => {
            const req = { merchant: { id: 'M1' } };
            const key = AssetIssuerRateLimiter.getBurstKey(req);
            expect(key).toBe('asset:issuer:burst:merchant:M1');
        });

        test('should key both tiers off the same resolved actor (Issue #1052)', () => {
            const reqs = [
                { merchant: { id: 'M1' } },
                { headers: { 'x-api-key': 'sk_test_1234567890abcdef' }, ip: '1.2.3.4' },
                { ip: '9.9.9.9' },
            ];

            for (const req of reqs) {
                const standard = AssetIssuerRateLimiter.getKey(req);
                const burst = AssetIssuerRateLimiter.getBurstKey(req);
                expect(burst).toBe(standard.replace('asset:issuer:', 'asset:issuer:burst:'));
            }
        });

        test('should report the actor type for logging', () => {
            expect(AssetIssuerRateLimiter._resolveActor({ merchant: { id: 'M1' } }).actorType).toBe('merchant');
            expect(AssetIssuerRateLimiter._resolveActor({ headers: { 'x-api-key': 'sk_test_1' } }).actorType).toBe('api_key');
            expect(AssetIssuerRateLimiter._resolveActor({ ip: '1.2.3.4' }).actorType).toBe('ip');
        });
    });

    describe('createRateLimiter', () => {
        test('should create rate limiter with correct config', () => {
            AssetIssuerRateLimiter.createRateLimiter();
            expect(mockRateLimit).toHaveBeenCalled();
            const callArg = mockRateLimit.mock.calls[0][0];
            expect(callArg.windowMs).toBe(5 * 60 * 1000);
            expect(callArg.max).toBe(50);
            expect(callArg.standardHeaders).toBe(true);
            expect(callArg.passOnStoreError).toBe(true);
        });

        test('should skip rate limiting for enterprise merchants', () => {
            const mockReq = { merchant: { metadata: { tier: 'enterprise' } } };
            AssetIssuerRateLimiter.createRateLimiter();
            const callArg = mockRateLimit.mock.calls[0][0];
            const result = callArg.skip(mockReq);
            expect(result).toBe(true);
        });

        test('should not skip rate limiting for regular merchants', () => {
            const mockReq = { merchant: { id: 'M1' } };
            AssetIssuerRateLimiter.createRateLimiter();
            const callArg = mockRateLimit.mock.calls[0][0];
            const result = callArg.skip(mockReq);
            expect(result).toBe(false);
        });
    });

    describe('createBurstRateLimiter', () => {
        test('should create burst rate limiter with correct config', () => {
            AssetIssuerRateLimiter.createBurstRateLimiter();
            expect(mockRateLimit).toHaveBeenCalled();
            const callArg = mockRateLimit.mock.calls[0][0];
            expect(callArg.windowMs).toBe(10 * 1000);
            expect(callArg.max).toBe(10);
        });

        test('should apply the same tier exemption as the standard limiter (Issue #1052)', () => {
            AssetIssuerRateLimiter.createBurstRateLimiter();
            const callArg = mockRateLimit.mock.calls[0][0];

            expect(callArg.skip({ merchant: { metadata: { tier: 'enterprise' } } })).toBe(true);
            expect(callArg.skip({ merchant: { metadata: { tier: 'premium' } } })).toBe(true);
            expect(callArg.skip({ merchant: { id: 'M1' } })).toBe(false);
        });
    });

    describe('handler', () => {
        test('should log and return 429 on rate limit exceeded', () => {
            AssetIssuerRateLimiter.createRateLimiter();
            const callArg = mockRateLimit.mock.calls[0][0];
            const mockReq = { ip: '1.2.3.4', merchant: {}, headers: {} };
            const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };
            callArg.handler(mockReq, mockRes, vi.fn(), { max: 50, windowMs: 300000 });
            expect(mockLogger.warn).toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(429);
        });
    });
});

// ============================================================================
// Issue #888: Cryptographic Signature Verification
// ============================================================================
describe('AssetIssuerSignatureVerifier (Issue #888)', () => {
    let verifier;

    beforeEach(() => {
        verifier = new AssetIssuerSignatureVerifier();
        vi.clearAllMocks();
    });

    describe('verifyOperation', () => {
        test('should return valid result when signature is valid', async () => {
            mockVerifyTransactionSignature.mockResolvedValue({
                valid: true,
                reason: 'Signature verified',
                isMultiSig: false,
                signatureCount: 1,
                thresholdMet: true,
            });

            mockWithHorizonRetry.mockResolvedValue({
                envelope_xdr: 'AAAA...',
                source_account: 'GBXX',
            });

            const mockTransaction = {
                operations: [{
                    type: 'payment',
                    asset: {
                        isNative: () => false,
                        getCode: () => 'USDC',
                        getIssuer: () => 'GBXX',
                    },
                    amount: '100',
                }],
            };

            const { Transaction } = await import('stellar-sdk');
            Transaction.mockImplementation(() => mockTransaction);

            const result = await verifier.verifyOperation('txHash123');
            expect(result.valid).toBe(true);
            expect(result.assetIssuerSpecific).toBe(true);
        });

        test('should return invalid when basic verification fails', async () => {
            mockVerifyTransactionSignature.mockResolvedValue({
                valid: false,
                reason: 'Invalid signature',
                isMultiSig: false,
                signatureCount: 0,
                thresholdMet: false,
            });

            const result = await verifier.verifyOperation('txHash123');
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Basic signature verification failed');
        });

        test('should use cache on repeated calls', async () => {
            mockVerifyTransactionSignature.mockResolvedValue({
                valid: true,
                reason: 'Signature verified',
                isMultiSig: false,
                signatureCount: 1,
                thresholdMet: true,
            });

            mockWithHorizonRetry.mockResolvedValue({
                envelope_xdr: 'AAAA...',
                source_account: 'GBXX',
            });

            const { Transaction } = await import('stellar-sdk');
            Transaction.mockImplementation(() => ({
                operations: [{ type: 'payment', asset: { isNative: () => false, getCode: () => 'USDC', getIssuer: () => 'GBXX' }, amount: '100' }],
            }));

            await verifier.verifyOperation('txHash123');
            await verifier.verifyOperation('txHash123');

            expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(1);
        });

        test('should skip cache when skipCache is true', async () => {
            mockVerifyTransactionSignature.mockResolvedValue({
                valid: true,
                reason: 'Signature verified',
                isMultiSig: false,
                signatureCount: 1,
                thresholdMet: true,
            });

            mockWithHorizonRetry.mockResolvedValue({
                envelope_xdr: 'AAAA...',
                source_account: 'GBXX',
            });

            const { Transaction } = await import('stellar-sdk');
            Transaction.mockImplementation(() => ({
                operations: [{ type: 'payment', asset: { isNative: () => false, getCode: () => 'USDC', getIssuer: () => 'GBXX' }, amount: '100' }],
            }));

            await verifier.verifyOperation('txHash123', { skipCache: true });
            await verifier.verifyOperation('txHash123', { skipCache: true });

            expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(2);
        });

        // Issue #1313: null options used to throw while destructuring.
        test('accepts null options without throwing', async () => {
            mockVerifyTransactionSignature.mockResolvedValue({ valid: false, reason: 'bad' });

            const result = await verifier.verifyOperation('txHashNull', null);

            expect(result.valid).toBe(false);
        });

        // Issue #1312: the verification cache must stay bounded.
        test('evicts the oldest cache entry once the cache is full', async () => {
            mockVerifyTransactionSignature.mockResolvedValue({ valid: false, reason: 'bad' });

            for (let i = 0; i < 1001; i++) {
                await verifier.verifyOperation(`tx-${i}`);
            }

            expect(verifier.verificationCache.size).toBe(1000);
        });

        // Issue #1315: concurrent verifications of the same transaction
        // used to race past the empty cache and each perform their own
        // Horizon round trip. Concurrent calls for the same key should now
        // coalesce onto a single in-flight verification.
        test('coalesces concurrent calls for the same transaction into a single verification', async () => {
            let resolveSignature;
            mockVerifyTransactionSignature.mockReturnValue(
                new Promise((resolve) => { resolveSignature = resolve; })
            );

            mockWithHorizonRetry.mockResolvedValue({
                envelope_xdr: 'AAAA...',
                source_account: 'GBXX',
            });

            const { Transaction } = await import('stellar-sdk');
            Transaction.mockImplementation(() => ({
                operations: [{ type: 'payment', asset: { isNative: () => false, getCode: () => 'USDC', getIssuer: () => 'GBXX' }, amount: '100' }],
            }));

            const call1 = verifier.verifyOperation('txHashRace');
            const call2 = verifier.verifyOperation('txHashRace');

            resolveSignature({
                valid: true,
                reason: 'Signature verified',
                isMultiSig: false,
                signatureCount: 1,
                thresholdMet: true,
            });

            const [result1, result2] = await Promise.all([call1, call2]);

            expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(1);
            expect(result1).toEqual(result2);
        });

        test('does not coalesce calls with skipCache: true', async () => {
            mockVerifyTransactionSignature.mockResolvedValue({
                valid: true,
                reason: 'Signature verified',
                isMultiSig: false,
                signatureCount: 1,
                thresholdMet: true,
            });
            mockWithHorizonRetry.mockResolvedValue({ envelope_xdr: 'AAAA...', source_account: 'GBXX' });

            const { Transaction } = await import('stellar-sdk');
            Transaction.mockImplementation(() => ({
                operations: [{ type: 'payment', asset: { isNative: () => false, getCode: () => 'USDC', getIssuer: () => 'GBXX' }, amount: '100' }],
            }));

            await Promise.all([
                verifier.verifyOperation('txHashNoCoalesce', { skipCache: true }),
                verifier.verifyOperation('txHashNoCoalesce', { skipCache: true }),
            ]);

            expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(2);
        });

        test('clears the pending-verification entry after completion so later calls run fresh', async () => {
            mockVerifyTransactionSignature.mockResolvedValue({
                valid: true,
                reason: 'Signature verified',
                isMultiSig: false,
                signatureCount: 1,
                thresholdMet: true,
            });
            mockWithHorizonRetry.mockResolvedValue({ envelope_xdr: 'AAAA...', source_account: 'GBXX' });

            const { Transaction } = await import('stellar-sdk');
            Transaction.mockImplementation(() => ({
                operations: [{ type: 'payment', asset: { isNative: () => false, getCode: () => 'USDC', getIssuer: () => 'GBXX' }, amount: '100' }],
            }));

            await verifier.verifyOperation('txHashSequential');
            expect(verifier.pendingVerifications.size).toBe(0);
        });

        test('should clear cache', () => {
            verifier.verificationCache.set('test', 'value');
            verifier.clearCache();
            expect(verifier.verificationCache.size).toBe(0);
        });
    });

    describe('verifyAssetIssuerOperation', () => {
        test('should log and report failure when Horizon rejects (Issue #1052)', async () => {
            mockWithHorizonRetry.mockRejectedValue(new Error('horizon unavailable'));

            const result = await verifier.verifyAssetIssuerOperation('txHash123');
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('horizon unavailable');
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.objectContaining({ txHash: 'txHash123' }),
                'Asset issuer operation verification failed'
            );
        });

        test('should detect no operations in transaction', async () => {
            mockWithHorizonRetry.mockResolvedValue({
                envelope_xdr: 'AAAA...',
                source_account: 'GBXX',
            });

            const { Transaction } = await import('stellar-sdk');
            Transaction.mockImplementation(() => ({ operations: [] }));

            const result = await verifier.verifyAssetIssuerOperation('txHash123');
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('No operations found');
        });

        test('should extract asset info from payment operations', async () => {
            mockWithHorizonRetry.mockResolvedValue({
                envelope_xdr: 'AAAA...',
                source_account: 'GBXX',
            });

            const { Transaction } = await import('stellar-sdk');
            Transaction.mockImplementation(() => ({
                operations: [{
                    type: 'payment',
                    asset: {
                        isNative: () => false,
                        getCode: () => 'USDC',
                        getIssuer: () => 'GBXX',
                    },
                    amount: '100',
                }],
            }));

            const result = await verifier.verifyAssetIssuerOperation('txHash123');
            expect(result.valid).toBe(true);
            expect(result.assetCode).toBe('USDC');
            expect(result.assetIssuer).toBe('GBXX');
            expect(result.operationType).toBe('payment');
        });

        test('should handle native XLM asset', async () => {
            mockWithHorizonRetry.mockResolvedValue({
                envelope_xdr: 'AAAA...',
                source_account: 'GBXX',
            });

            const { Transaction } = await import('stellar-sdk');
            Transaction.mockImplementation(() => ({
                operations: [{
                    type: 'payment',
                    asset: {
                        isNative: () => true,
                    },
                    amount: '100',
                }],
            }));

            const result = await verifier.verifyAssetIssuerOperation('txHash123');
            expect(result.valid).toBe(true);
            expect(result.assetCode).toBe('XLM');
        });

        test('should detect operation type mismatch', async () => {
            mockWithHorizonRetry.mockResolvedValue({
                envelope_xdr: 'AAAA...',
                source_account: 'GBXX',
            });

            const { Transaction } = await import('stellar-sdk');
            Transaction.mockImplementation(() => ({
                operations: [{
                    type: 'payment',
                    asset: {
                        isNative: () => false,
                        getCode: () => 'USDC',
                        getIssuer: () => 'GBXX',
                    },
                    amount: '100',
                }],
            }));

            const result = await verifier.verifyAssetIssuerOperation('txHash123', 'changeTrust');
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Operation type mismatch');
        });

        test('should detect asset code mismatch', async () => {
            mockWithHorizonRetry.mockResolvedValue({
                envelope_xdr: 'AAAA...',
                source_account: 'GBXX',
            });

            const { Transaction } = await import('stellar-sdk');
            Transaction.mockImplementation(() => ({
                operations: [{
                    type: 'payment',
                    asset: {
                        isNative: () => false,
                        getCode: () => 'USDC',
                        getIssuer: () => 'GBXX',
                    },
                    amount: '100',
                }],
            }));

            const result = await verifier.verifyAssetIssuerOperation('txHash123', null, 'ETH');
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Asset code mismatch');
        });

        test('should detect asset issuer mismatch', async () => {
            mockWithHorizonRetry.mockResolvedValue({
                envelope_xdr: 'AAAA...',
                source_account: 'GBXX',
            });

            const { Transaction } = await import('stellar-sdk');
            Transaction.mockImplementation(() => ({
                operations: [{
                    type: 'payment',
                    asset: {
                        isNative: () => false,
                        getCode: () => 'USDC',
                        getIssuer: () => 'GAXX',
                    },
                    amount: '100',
                }],
            }));

            const result = await verifier.verifyAssetIssuerOperation('txHash123', null, null, 'GBYY');
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Asset issuer mismatch');
        });
    });
});

// ============================================================================
// Issue #889: Optimized SQL Queries
// ============================================================================
describe('AssetIssuerQueryOptimizer (Issue #889)', () => {
    beforeEach(() => {
        AssetIssuerErrorRecovery.resetCircuitBreaker();
        // Issue #1050: getIssuerStats/getAssetIssuerHealthMetrics are cached
        // now, and these tests assert on mockQueryWithRetry.mock.calls[0] after
        // a single call. Without clearing, an entry left by an earlier test
        // serves the result from cache and no query is issued, so calls[0]
        // belongs to whichever test ran first.
        AssetIssuerQueryOptimizer.invalidateQueryCache();
        vi.clearAllMocks();
    });

    describe('getIssuerStats', () => {
        test('should fetch issuer statistics with aggregation', async () => {
            const mockRows = [{
                asset: 'USDC',
                payment_count: 5,
                total_volume: '1000',
                confirmed_count: 4,
                failed_count: 1,
            }];
            mockQueryWithRetry.mockResolvedValue({ rows: mockRows });

            const result = await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');
            expect(result.rows).toBe(mockRows);
            expect(mockQueryWithRetry).toHaveBeenCalledWith(
                expect.stringContaining('asset_issuer = $1'),
                ['GBXX']
            );
        });

        test('should include confirmed and failed counts', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });
            await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');
            const query = mockQueryWithRetry.mock.calls[0][0];
            expect(query).toContain("status = 'confirmed'");
            expect(query).toContain("status = 'failed'");
        });
    });

    describe('findPaymentsByAssetAndIssuer', () => {
        test('should filter by asset code and issuer', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });
            await AssetIssuerQueryOptimizer.findPaymentsByAssetAndIssuer('USDC', 'GBXX');
            const query = mockQueryWithRetry.mock.calls[0][0];
            const params = mockQueryWithRetry.mock.calls[0][1];
            expect(query).toContain('p.asset = $');
            expect(query).toContain('p.asset_issuer = $');
            expect(params).toContain('USDC');
            expect(params).toContain('GBXX');
        });

        test('should support additional filter options', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });
            await AssetIssuerQueryOptimizer.findPaymentsByAssetAndIssuer('USDC', 'GBXX', {
                status: 'confirmed',
                limit: 10,
                offset: 5,
                merchantId: 'M1',
            });
            const query = mockQueryWithRetry.mock.calls[0][0];
            expect(query).toContain('p.merchant_id = $');
            expect(query).toContain('p.status = $');
            expect(query).toContain('LIMIT $');
            expect(query).toContain('OFFSET $');
        });

        test('should handle date range filtering', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });
            await AssetIssuerQueryOptimizer.findPaymentsByAssetAndIssuer('USDC', 'GBXX', {
                dateFrom: '2026-01-01',
                dateTo: '2026-06-01',
            });
            const query = mockQueryWithRetry.mock.calls[0][0];
            expect(query).toContain('p.created_at >=');
            expect(query).toContain('p.created_at <=');
        });

        test('should handle NULL asset issuer for native assets', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });
            await AssetIssuerQueryOptimizer.findPaymentsByAssetAndIssuer('XLM', '');
            const query = mockQueryWithRetry.mock.calls[0][0];
            expect(query).toContain('p.asset_issuer IS NULL');
        });
    });

    describe('validateIssuerAgainstMerchant', () => {
        test('should validate issuer against merchant allowed issuers', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [{ id: 'M1', issuer_allowed: true }] });
            const result = await AssetIssuerQueryOptimizer.validateIssuerAgainstMerchant('M1', 'USDC', 'GBXX');
            expect(result.rows[0].issuer_allowed).toBe(true);
        });
    });

    describe('getAssetIssuerHealthMetrics', () => {
        test('should return health metrics with failure rates', async () => {
            mockQueryWithRetry.mockResolvedValue({
                rows: [{
                    asset: 'USDC',
                    asset_issuer: 'GBXX',
                    total_payments: 100,
                    failed_payments: 5,
                    failure_rate_percent: 5.00,
                    total_volume: '5000',
                }]
            });
            const result = await AssetIssuerQueryOptimizer.getAssetIssuerHealthMetrics('M1');
            expect(result.rows[0].failure_rate_percent).toBe(5.00);
        });

        // Issue #1316: merchant_config previously omitted the deleted_at
        // filter that every other merchant-scoped query in this file
        // applies, so a soft-deleted merchant's allowed_issuers/
        // payment_limits could still be joined into "current" health
        // metrics — inconsistent with the rest of the module's soft-delete
        // convention.
        test('excludes soft-deleted merchants from the merchant_config CTE', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });
            await AssetIssuerQueryOptimizer.getAssetIssuerHealthMetrics('M1');
            const query = mockQueryWithRetry.mock.calls[0][0];
            const merchantConfigSection = query.split('merchant_config AS')[1];
            expect(merchantConfigSection).toContain('m.deleted_at IS NULL');
        });
    });

    describe('logAssetIssuerVerification', () => {
        test('should insert verification log record', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [{ id: 'log1', created_at: new Date() }] });
            const result = await AssetIssuerQueryOptimizer.logAssetIssuerVerification({
                merchantId: 'M1',
                txHash: 'abc123',
                verification: {
                    valid: true,
                    operationType: 'payment',
                    isMultiSig: false,
                    signatureCount: 1,
                    thresholdMet: true,
                },
                assetCode: 'USDC',
                assetIssuer: 'GBXX',
            });
            expect(result.rows[0].id).toBe('log1');
        });

        // Issue #1313: a missing verification result used to surface as a
        // null pointer exception.
        test('rejects with a descriptive error when verification is missing', async () => {
            await expect(
                AssetIssuerQueryOptimizer.logAssetIssuerVerification({ merchantId: 'M1', txHash: 'abc123' })
            ).rejects.toThrow('requires a verification result');
            expect(mockQueryWithRetry).not.toHaveBeenCalled();
        });
    });

    describe('createOptimizedIndexes', () => {
        test('should attempt to create indexes', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });
            const results = await AssetIssuerQueryOptimizer.createOptimizedIndexes();
            expect(results.length).toBe(4);
            expect(results.every(r => r.success === true)).toBe(true);
        });

        test('should handle index creation errors gracefully', async () => {
            mockQueryWithRetry
                .mockResolvedValueOnce({ rows: [] })
                .mockRejectedValueOnce(new Error('index already exists'))
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] });
            const results = await AssetIssuerQueryOptimizer.createOptimizedIndexes();
            expect(results.some(r => !r.success)).toBe(true);
        });
    });
});

// ============================================================================
// Issue #1050: Query caching for issuer reads
// ============================================================================
describe('AssetIssuerQueryOptimizer query cache (Issue #1050)', () => {
    beforeEach(() => {
        AssetIssuerErrorRecovery.resetCircuitBreaker();
        AssetIssuerQueryOptimizer.invalidateQueryCache();
        vi.clearAllMocks();
    });

    afterEach(() => {
        AssetIssuerQueryOptimizer.invalidateQueryCache();
    });

    describe('getIssuerStats caching', () => {
        test('serves a repeated read from cache without re-querying', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [{ asset: 'USDC', total_volume: '10' }] });

            const first = await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');
            const second = await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');

            expect(mockQueryWithRetry).toHaveBeenCalledTimes(1);
            expect(second).toBe(first);
        });

        test('keys the cache per issuer', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });

            await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');
            await AssetIssuerQueryOptimizer.getIssuerStats('GBYY');

            expect(mockQueryWithRetry).toHaveBeenCalledTimes(2);
        });

        test('bypasses the cache when skipCache is set', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });

            await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');
            await AssetIssuerQueryOptimizer.getIssuerStats('GBXX', { skipCache: true });

            expect(mockQueryWithRetry).toHaveBeenCalledTimes(2);
        });

        test('does not cache a failed read', async () => {
            const error = new Error('bad request');
            error.status = 400;
            mockQueryWithRetry.mockRejectedValue(error);

            await expect(AssetIssuerQueryOptimizer.getIssuerStats('GBXX')).rejects.toThrow();

            expect(AssetIssuerQueryOptimizer.getQueryCacheStats().size).toBe(0);
        });
    });

    describe('getAssetIssuerHealthMetrics caching', () => {
        test('serves a repeated read from cache without re-querying', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [{ asset: 'USDC' }] });

            await AssetIssuerQueryOptimizer.getAssetIssuerHealthMetrics('M1');
            await AssetIssuerQueryOptimizer.getAssetIssuerHealthMetrics('M1');

            expect(mockQueryWithRetry).toHaveBeenCalledTimes(1);
        });

        test('keys the cache per merchant', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });

            await AssetIssuerQueryOptimizer.getAssetIssuerHealthMetrics('M1');
            await AssetIssuerQueryOptimizer.getAssetIssuerHealthMetrics('M2');

            expect(mockQueryWithRetry).toHaveBeenCalledTimes(2);
        });
    });

    describe('invalidation', () => {
        test('logging a verification drops the affected issuer and merchant entries', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });

            await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');
            await AssetIssuerQueryOptimizer.getAssetIssuerHealthMetrics('M1');
            expect(AssetIssuerQueryOptimizer.getQueryCacheStats().size).toBe(2);

            await AssetIssuerQueryOptimizer.logAssetIssuerVerification({
                merchantId: 'M1',
                txHash: 'abc123',
                assetIssuer: 'GBXX',
                verification: { valid: true, operationType: 'payment' },
            });

            expect(AssetIssuerQueryOptimizer.getQueryCacheStats().size).toBe(0);
        });

        test('leaves unrelated entries cached', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });

            await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');
            await AssetIssuerQueryOptimizer.getIssuerStats('GBYY');

            AssetIssuerQueryOptimizer.invalidateQueryCache({ assetIssuer: 'GBXX' });

            expect(AssetIssuerQueryOptimizer.getQueryCacheStats().size).toBe(1);
        });

        test('clears every entry when called with no arguments', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });

            await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');
            await AssetIssuerQueryOptimizer.getAssetIssuerHealthMetrics('M1');

            const removed = AssetIssuerQueryOptimizer.invalidateQueryCache();

            expect(removed).toBe(2);
            expect(AssetIssuerQueryOptimizer.getQueryCacheStats().size).toBe(0);
        });

        // A write that knows neither issuer nor merchant must not wipe the
        // cache for every other caller.
        test('is a no-op when an options object names neither key', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });

            await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');

            const removed = AssetIssuerQueryOptimizer.invalidateQueryCache({});

            expect(removed).toBe(0);
            expect(AssetIssuerQueryOptimizer.getQueryCacheStats().size).toBe(1);
        });
    });

    describe('cache bounds', () => {
        test('stays bounded under a stream of distinct issuers', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });

            for (let i = 0; i < 600; i++) {
                await AssetIssuerQueryOptimizer.getIssuerStats(`GB${i}`);
            }

            const stats = AssetIssuerQueryOptimizer.getQueryCacheStats();
            expect(stats.size).toBeLessThanOrEqual(stats.maxEntries);
            expect(stats.evictions).toBeGreaterThan(0);
        });

        test('reports hit and miss counters', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });

            await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');
            await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');

            const stats = AssetIssuerQueryOptimizer.getQueryCacheStats();
            expect(stats.hits).toBeGreaterThan(0);
            expect(stats.misses).toBeGreaterThan(0);
        });
    });
});

// ============================================================================
// Issue #1053: Granular metrics tracking
// ============================================================================
describe('Asset Issuer metrics (Issue #1053)', () => {
    beforeEach(() => {
        AssetIssuerErrorRecovery.resetCircuitBreaker();
        AssetIssuerErrorRecovery.drainDeadLetterQueue();
        AssetIssuerQueryOptimizer.invalidateQueryCache();
        vi.clearAllMocks();
    });

    afterEach(() => {
        AssetIssuerQueryOptimizer.invalidateQueryCache();
    });

    describe('query cache metrics', () => {
        test('counts a cache hit and a cache miss separately', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });

            await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');
            await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');

            expect(assetIssuerCacheOperationsTotal.inc).toHaveBeenCalledWith({ operation: 'miss' });
            expect(assetIssuerCacheOperationsTotal.inc).toHaveBeenCalledWith({ operation: 'hit' });
        });

        test('counts an eviction and keeps the size gauge in step', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });

            for (let i = 0; i < 520; i++) {
                await AssetIssuerQueryOptimizer.getIssuerStats(`GB${i}`);
            }

            expect(assetIssuerCacheOperationsTotal.inc).toHaveBeenCalledWith({ operation: 'eviction' });
            expect(assetIssuerCacheSize.set).toHaveBeenLastCalledWith(500);
        });

        test('counts an invalidation when a verification write drops an entry', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });

            await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');
            await AssetIssuerQueryOptimizer.logAssetIssuerVerification({
                merchantId: 'M1',
                txHash: 'abc123',
                assetIssuer: 'GBXX',
                verification: { valid: true, operationType: 'payment' },
            });

            expect(assetIssuerCacheOperationsTotal.inc).toHaveBeenCalledWith({ operation: 'invalidation' });
        });
    });

    describe('query duration metrics', () => {
        test('observes issuer stats reads labelled by query name', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });

            await AssetIssuerQueryOptimizer.getIssuerStats('GBXX');

            expect(assetIssuerQueryDuration.observe).toHaveBeenCalledWith(
                { query: 'issuer_stats' },
                expect.any(Number),
            );
        });

        test('observes health metrics reads labelled by query name', async () => {
            mockQueryWithRetry.mockResolvedValue({ rows: [] });

            await AssetIssuerQueryOptimizer.getAssetIssuerHealthMetrics('M1');

            expect(assetIssuerQueryDuration.observe).toHaveBeenCalledWith(
                { query: 'health_metrics' },
                expect.any(Number),
            );
        });

        test('observes a failed read before rethrowing', async () => {
            const error = new Error('bad request');
            error.status = 400;
            mockQueryWithRetry.mockRejectedValue(error);

            await expect(AssetIssuerQueryOptimizer.getIssuerStats('GBXX')).rejects.toThrow();

            expect(assetIssuerQueryDuration.observe).toHaveBeenCalledWith(
                { query: 'issuer_stats' },
                expect.any(Number),
            );
        });
    });

    describe('verification metrics', () => {
        test('counts a valid verification by result and operation type', async () => {
            mockVerifyTransactionSignature.mockResolvedValue({
                valid: true, reason: 'ok', isMultiSig: false, signatureCount: 1, thresholdMet: true,
            });
            mockWithHorizonRetry.mockResolvedValue({ envelope_xdr: 'AAAA', source_account: 'GBXX' });
            const { Transaction } = await import('stellar-sdk');
            Transaction.mockImplementation(() => ({
                operations: [{ type: 'payment', asset: { isNative: () => false, getCode: () => 'USDC', getIssuer: () => 'GBXX' }, amount: '1' }],
            }));

            const verifier = new AssetIssuerSignatureVerifier();
            await verifier.verifyOperation('txMetricsValid');

            expect(assetIssuerVerificationsTotal.inc).toHaveBeenCalledWith({ result: 'valid', operation: 'payment' });
        });

        test('counts an invalid verification', async () => {
            mockVerifyTransactionSignature.mockResolvedValue({ valid: false, reason: 'bad' });

            const verifier = new AssetIssuerSignatureVerifier();
            await verifier.verifyOperation('txMetricsInvalid');

            expect(assetIssuerVerificationsTotal.inc).toHaveBeenCalledWith({ result: 'invalid', operation: 'any' });
        });
    });

    describe('error recovery metrics', () => {
        test('counts a non-retryable rejection by error type', async () => {
            const error = new Error('bad request');
            error.status = 400;

            await expect(
                AssetIssuerErrorRecovery.executeWithRecovery(
                    () => Promise.reject(error),
                    'metrics_rejected',
                )
            ).rejects.toThrow();

            expect(assetIssuerErrorRecoveryTotal.inc).toHaveBeenCalledWith({
                error_type: 'client_error',
                outcome: 'rejected',
            });
        });

        test('counts retries being exhausted', async () => {
            await expect(
                AssetIssuerErrorRecovery.executeWithRecovery(
                    () => Promise.reject(new Error('network error')),
                    'metrics_exhausted',
                )
            ).rejects.toThrow();

            expect(assetIssuerErrorRecoveryTotal.inc).toHaveBeenCalledWith({
                error_type: 'network',
                outcome: 'exhausted',
            });
        }, 30000);

        test('counts a recovery when an operation succeeds after earlier failures', async () => {
            const op = vi.fn()
                .mockRejectedValueOnce(new Error('network error'))
                .mockResolvedValue('ok');

            await AssetIssuerErrorRecovery.executeWithRecovery(op, 'metrics_recovered');

            expect(assetIssuerErrorRecoveryTotal.inc).toHaveBeenCalledWith({
                error_type: 'network',
                outcome: 'recovered',
            });
        }, 30000);
    });

    describe('circuit breaker and dead letter gauges', () => {
        test('reports zero open breakers when all contexts are healthy', () => {
            AssetIssuerErrorRecovery.getCircuitBreakerMetrics();

            expect(assetIssuerOpenCircuitBreakers.set).toHaveBeenLastCalledWith(0);
            expect(assetIssuerCircuitBreakerState.set).toHaveBeenLastCalledWith(0);
        });

        test('reports an open breaker once a context trips', async () => {
            const error = new Error('bad request');
            error.status = 400;

            for (let i = 0; i < 5; i++) {
                await expect(
                    AssetIssuerErrorRecovery.executeWithRecovery(() => Promise.reject(error), 'metrics_cb')
                ).rejects.toThrow();
            }

            AssetIssuerErrorRecovery.getCircuitBreakerMetrics();

            expect(assetIssuerOpenCircuitBreakers.set).toHaveBeenLastCalledWith(1);
            expect(assetIssuerCircuitBreakerState.set).toHaveBeenLastCalledWith(1);
        });

        test('tracks the dead letter queue size as entries are added and drained', async () => {
            const error = new Error('bad request');
            error.status = 400;

            await expect(
                AssetIssuerErrorRecovery.executeWithRecovery(() => Promise.reject(error), 'metrics_dlq')
            ).rejects.toThrow();

            expect(assetIssuerDeadLetterQueueSize.set).toHaveBeenLastCalledWith(1);

            AssetIssuerErrorRecovery.drainDeadLetterQueue();

            expect(assetIssuerDeadLetterQueueSize.set).toHaveBeenLastCalledWith(0);
        });
    });
});

// ============================================================================
// AssetIssuerManager Integration
// ============================================================================
describe('AssetIssuerManager', () => {
    beforeEach(() => {
        AssetIssuerErrorRecovery.resetCircuitBreaker();
        AssetIssuerQueryOptimizer.invalidateQueryCache();
        vi.clearAllMocks();
    });

    test('should be a singleton instance', () => {
        expect(assetIssuerManager).toBeDefined();
        expect(assetIssuerManager).toBeInstanceOf(AssetIssuerManager);
    });

    test('should have all four components initialized', () => {
        const mgr = new AssetIssuerManager();
        expect(mgr.signatureVerifier).toBeDefined();
        expect(mgr.rateLimiter).toBeDefined();
        expect(mgr.errorRecovery).toBeDefined();
        expect(mgr.queryOptimizer).toBeDefined();
    });

    test('verifyAssetIssuerTransaction should orchestrate verification', async () => {
        mockVerifyTransactionSignature.mockResolvedValue({
            valid: true,
            reason: 'Signature verified',
            isMultiSig: false,
            signatureCount: 1,
            thresholdMet: true,
        });

        mockWithHorizonRetry.mockResolvedValue({
            envelope_xdr: 'AAAA...',
            source_account: 'GBXX',
        });

        const { Transaction } = await import('stellar-sdk');
        Transaction.mockImplementation(() => ({
            operations: [{
                type: 'payment',
                asset: { isNative: () => false, getCode: () => 'USDC', getIssuer: () => 'GBXX' },
                amount: '100',
            }],
        }));

        const result = await assetIssuerManager.verifyAssetIssuerTransaction('txHash123');
        expect(result.valid).toBe(true);
    });

    test('getMerchantIssuerConfig should return health data', async () => {
        mockQueryWithRetry.mockResolvedValue({ rows: [] });
        const config = await assetIssuerManager.getMerchantIssuerConfig('M1');
        expect(config.healthMetrics).toBeDefined();
        expect(config.circuitBreakers).toBeDefined();
        expect(config.timestamp).toBeDefined();
    });

    test('getCircuitBreakerMetrics should return metrics', () => {
        const metrics = assetIssuerManager.getCircuitBreakerMetrics();
        expect(typeof metrics).toBe('object');
    });

    test('getDeadLetterQueue should return queue', () => {
        const dlq = assetIssuerManager.getDeadLetterQueue();
        expect(Array.isArray(dlq)).toBe(true);
    });

    test('initialize should create indexes', async () => {
        mockQueryWithRetry.mockResolvedValue({ rows: [] });
        const result = await assetIssuerManager.initialize();
        expect(result.success).toBe(true);
    });
});

describe('createAssetIssuerRateLimits', () => {
    test('should create standard and burst rate limiters', () => {
        const limits = createAssetIssuerRateLimits({ isOpen: true, sendCommand: vi.fn() });
        expect(limits.standard).toBeDefined();
        expect(limits.burst).toBeDefined();
    });
});
