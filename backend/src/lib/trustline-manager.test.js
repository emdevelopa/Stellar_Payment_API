/**
 * Comprehensive test suite for Trustline Manager
 * Tests all four optimization tasks: signature verification, rate limiting, error recovery, and SQL optimization
 */

import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';

// Mock dependencies first
const {
  mockQueryWithRetry,
  mockVerifyTransactionSignature,
  mockWithHorizonRetry,
  mockIsValidStellarAccountId,
  mockIsValidAssetCode,
  mockStellarTransaction,
  mockStellarServer,
  mockRateLimit,
  mockIpKeyGenerator,
} = vi.hoisted(() => ({
  mockQueryWithRetry: vi.fn(),
  mockVerifyTransactionSignature: vi.fn(),
  mockWithHorizonRetry: vi.fn(),
  mockIsValidStellarAccountId: vi.fn(),
  mockIsValidAssetCode: vi.fn(),
  mockStellarTransaction: vi.fn(),
  mockStellarServer: vi.fn().mockImplementation(() => ({
    transactions: () => ({
      transaction: vi.fn().mockReturnValue({
        call: vi.fn(),
      }),
    }),
  })),
  mockRateLimit: vi.fn(),
  mockIpKeyGenerator: vi.fn(),
}));

vi.mock('./db.js', () => ({ queryWithRetry: mockQueryWithRetry }));
vi.mock('./stellar.js', () => ({
  verifyTransactionSignature: mockVerifyTransactionSignature,
  withHorizonRetry: mockWithHorizonRetry,
  isValidStellarAccountId: mockIsValidStellarAccountId,
  isValidAssetCode: mockIsValidAssetCode,
}));
vi.mock('./rate-limit.js', () => ({
  createRedisRateLimitStore: vi.fn(),
  RATE_LIMIT_REDIS_PREFIX: 'rl:',
}));
vi.mock('stellar-sdk', () => ({
  Horizon: { Server: mockStellarServer },
  Networks: {
    PUBLIC: 'Public Global Stellar Network ; September 2015',
    TESTNET: 'Test SDF Network ; September 2015',
  },
  Transaction: mockStellarTransaction,
}));
vi.mock('express-rate-limit', () => ({ default: mockRateLimit, ipKeyGenerator: mockIpKeyGenerator }));
const mockLogger = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('./logger.js', () => mockLogger);

// Now import the modules
import {
  TrustlineSignatureVerifier,
  TrustlineRateLimiter,
  TrustlineErrorRecovery,
  TrustlineQueryOptimizer,
  TrustlineManager,
  trustlineManager,
  TRUSTLINE_RATE_LIMIT_WINDOW_MS,
  TRUSTLINE_RATE_LIMIT_MAX,
  TRUSTLINE_VERIFICATION_RATE_LIMIT_MAX,
  TRUSTLINE_BURST_WINDOW_MS,
  TRUSTLINE_BURST_MAX,
} from './trustline-manager.js';
import { queryWithRetry } from './db.js';
import { 
  verifyTransactionSignature,
  withHorizonRetry,
  isValidStellarAccountId,
  isValidAssetCode 
} from './stellar.js';
import * as StellarSdk from 'stellar-sdk';
import _rateLimit from 'express-rate-limit';

describe('Trustline Manager - Task #595: Cryptographic Signature Verification', () => {
  let verifier;

  beforeEach(() => {
    verifier = new TrustlineSignatureVerifier();
    vi.clearAllMocks();
  });

  describe('TrustlineSignatureVerifier', () => {
    test('should verify valid trustline signature', async () => {
      const txHash = 'valid_tx_hash';
      
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: true,
        reason: 'Signature verification passed',
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true
      });

      mockWithHorizonRetry.mockResolvedValue({
        envelope_xdr: 'mock_xdr'
      });

      // Mock Transaction constructor
      const mockTransaction = {
        operations: [{
          type: 'changeTrust',
          asset: {
            isNative: () => false,
            getCode: () => 'USDC',
            getIssuer: () => 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
          },
          limit: '1000'
        }]
      };

      mockStellarTransaction.mockImplementation(() => mockTransaction);
      mockIsValidAssetCode.mockReturnValue(true);
      mockIsValidStellarAccountId.mockReturnValue(true);

      const result = await verifier.verifyTrustlineSignature(txHash);
      expect(result.valid).toBe(true);
      expect(result.trustlineSpecific).toBe(true);
      expect(result.operationType).toBe('changeTrust');
      expect(result.assetCode).toBe('USDC');
    });

    test('should reject invalid transaction hash', async () => {
      const result = await verifier.verifyTrustlineSignature('');
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid transaction hash');
    });

    test('should handle signature verification failure', async () => {
      const txHash = 'invalid_tx_hash';
      
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: false,
        reason: 'Invalid signature',
        isMultiSig: false,
        signatureCount: 0,
        thresholdMet: false
      });

      const result = await verifier.verifyTrustlineSignature(txHash);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Basic signature verification failed: Invalid signature');
    });

    test('should validate trustline operation type', async () => {
      const txHash = 'valid_tx_hash';
      
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: true,
        reason: 'Signature verification passed',
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true
      });

      mockWithHorizonRetry.mockResolvedValue({
        envelope_xdr: 'mock_xdr'
      });

      mockStellarTransaction.mockImplementation(() => ({
        operations: [{
          type: 'payment', // Wrong operation type
          destination: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          amount: '100'
        }]
      }));

      const result = await verifier.verifyTrustlineSignature(txHash);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('No trustline operations found');
    });

    test('should cache verification results', async () => {
      const txHash = 'cached_tx_hash';
      
      mockVerifyTransactionSignature.mockResolvedValue({
        valid: true,
        reason: 'Signature verification passed',
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true
      });

      mockWithHorizonRetry.mockResolvedValue({
        envelope_xdr: 'mock_xdr'
      });

      mockStellarTransaction.mockImplementation(() => ({
        operations: [{
          type: 'changeTrust',
          asset: {
            isNative: () => false,
            getCode: () => 'USDC',
            getIssuer: () => 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
          },
          limit: '1000'
        }]
      }));

      mockIsValidAssetCode.mockReturnValue(true);
      mockIsValidStellarAccountId.mockReturnValue(true);

      // First call
      await verifier.verifyTrustlineSignature(txHash);
      
      // Second call should use cache
      await verifier.verifyTrustlineSignature(txHash);

      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(1);
    });

    test('should bypass cache when skipCache is true', async () => {
      const txHash = 'skip_cache_tx_hash';

      mockVerifyTransactionSignature.mockResolvedValue({
        valid: true,
        reason: 'Signature verification passed',
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true
      });

      mockWithHorizonRetry.mockResolvedValue({
        envelope_xdr: 'mock_xdr'
      });

      mockStellarTransaction.mockImplementation(() => ({
        operations: [{
          type: 'changeTrust',
          asset: {
            isNative: () => false,
            getCode: () => 'USDC',
            getIssuer: () => 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
          },
          limit: '1000'
        }]
      }));

      mockIsValidAssetCode.mockReturnValue(true);
      mockIsValidStellarAccountId.mockReturnValue(true);

      await verifier.verifyTrustlineSignature(txHash, { skipCache: true });
      await verifier.verifyTrustlineSignature(txHash, { skipCache: true });

      expect(mockVerifyTransactionSignature).toHaveBeenCalledTimes(2);
    });

    test('should reject native assets in changeTrust operations', async () => {
      const txHash = 'native_asset_hash';

      mockVerifyTransactionSignature.mockResolvedValue({
        valid: true,
        reason: 'Signature verification passed',
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true
      });

      mockWithHorizonRetry.mockResolvedValue({
        envelope_xdr: 'mock_xdr'
      });

      mockStellarTransaction.mockImplementation(() => ({
        operations: [{
          type: 'changeTrust',
          asset: {
            isNative: () => true,
          },
          limit: '1000'
        }]
      }));

      const result = await verifier.verifyTrustlineSignature(txHash);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Native asset trustlines are not allowed');
    });

    test('should verify allowTrust operations', async () => {
      const txHash = 'allow_trust_hash';

      mockVerifyTransactionSignature.mockResolvedValue({
        valid: true,
        reason: 'Signature verification passed',
        isMultiSig: false,
        signatureCount: 1,
        thresholdMet: true
      });

      mockWithHorizonRetry.mockResolvedValue({
        envelope_xdr: 'mock_xdr',
        source_account: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
      });

      mockStellarTransaction.mockImplementation(() => ({
        source: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        operations: [{
          type: 'allowTrust',
          assetCode: 'USDC',
          trustor: 'GC3C4N6LRO2QG5AOKJ6VBA7T6C6IRPZO7KE6UQWJH7Y2ZKAEW4ZJ7KVN'
        }]
      }));

      mockIsValidAssetCode.mockReturnValue(true);
      mockIsValidStellarAccountId.mockReturnValue(true);

      const result = await verifier.verifyTrustlineSignature(txHash, 'allowTrust');

      expect(result.valid).toBe(true);
      expect(result.operationType).toBe('allowTrust');
      expect(result.assetCode).toBe('USDC');
    });
  });
});

describe('Trustline Manager - Task #594: Rate Limiting', () => {
  describe('TrustlineRateLimiter', () => {
    test('should generate correct rate limit key for merchant', () => {
      const req = {
        merchant: { id: 'merchant_123' },
        ip: '192.168.1.1'
      };

      const key = TrustlineRateLimiter.getTrustlineOperationKey(req);
      expect(key).toBe('trustline:ops:merchant:merchant_123');
    });

    test('should generate correct rate limit key for API key', () => {
      const req = {
        headers: { 'x-api-key': 'test_api_key' },
        ip: '192.168.1.1'
      };
      mockIpKeyGenerator.mockReturnValue('hashed-ip');
      const key = TrustlineRateLimiter.getTrustlineOperationKey(req);
      expect(key).toMatch(/^trustline:ops:api:[a-f0-9]{16}$/);
    });

    test('should generate correct rate limit key for IP', () => {
      const req = {
        ip: '192.168.1.1'
      };
      mockIpKeyGenerator.mockReturnValue('192.168.1.1');
      const key = TrustlineRateLimiter.getTrustlineOperationKey(req);
      expect(key).toBe('trustline:ops:ip:192.168.1.1');
    });

    test('should create trustline operation rate limiter', () => {
      const mockStore = {};
      const rateLimitFactory = mockRateLimit;

      TrustlineRateLimiter.createTrustlineOperationRateLimit({
        store: mockStore,
        rateLimitFactory: rateLimitFactory
      });

      expect(rateLimitFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          windowMs: 5 * 60 * 1000, // 5 minutes
          max: 20,
          keyGenerator: TrustlineRateLimiter.getTrustlineOperationKey
        })
      );
    });

    test('should skip rate limiting for premium merchants', () => {
      const mockStore = {};
      const rateLimitFactory = mockRateLimit;

      TrustlineRateLimiter.createTrustlineOperationRateLimit({
        store: mockStore,
        rateLimitFactory: rateLimitFactory
      });

      const config = rateLimitFactory.mock.calls[0][0];
      
      // Test skip function for premium merchant
      const premiumReq = {
        merchant: { metadata: { tier: 'premium' } }
      };
      expect(config.skip(premiumReq)).toBe(true);

      // Test skip function for regular merchant
      const regularReq = {
        merchant: { metadata: { tier: 'basic' } }
      };
      expect(config.skip(regularReq)).toBe(false);
    });
  });
});

describe('Trustline Manager - Task #746: Enhanced Error Recovery', () => {
  beforeEach(() => {
    // Reset ALL per-context circuit breakers and drain the DLQ
    TrustlineErrorRecovery.resetCircuitBreaker();
    TrustlineErrorRecovery.drainDeadLetterQueue();
    vi.clearAllMocks();
  });

  describe('TrustlineErrorRecovery – basic execution', () => {
    test('should execute operation successfully on first try', async () => {
      const mockOperation = vi.fn().mockResolvedValue('success');
      const result = await TrustlineErrorRecovery.executeWithRecovery(mockOperation);
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    test('should retry on retryable errors', async () => {
      vi.spyOn(TrustlineErrorRecovery, 'sleep').mockResolvedValue(undefined);
      const mockOperation = vi.fn()
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockResolvedValue('success');

      const result = await TrustlineErrorRecovery.executeWithRecovery(mockOperation);
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(3);

      vi.restoreAllMocks();
    });

    test('should not retry on non-retryable errors', async () => {
      const error = new Error('asset not found');
      error.status = 404;
      const mockOperation = vi.fn().mockRejectedValue(error);

      await expect(
        TrustlineErrorRecovery.executeWithRecovery(mockOperation),
      ).rejects.toThrow('asset not found');

      expect(mockOperation).toHaveBeenCalledTimes(1);
    });
  });

  describe('TrustlineErrorRecovery – error classification', () => {
    test('should classify network errors as retryable with high priority', () => {
      const networkError = new Error('network timeout');
      const c = TrustlineErrorRecovery.classifyError(networkError);
      expect(c.type).toBe('network');
      expect(c.retryable).toBe(true);
      expect(c.priority).toBe('high');
    });

    test('should classify timeout errors (isTimeout flag) as retryable', () => {
      const err = new Error('operation timed out after 15000ms');
      err.isTimeout = true;
      const c = TrustlineErrorRecovery.classifyError(err);
      expect(c.type).toBe('timeout');
      expect(c.retryable).toBe(true);
    });

    test('should classify rate limit errors (HTTP 429) as retryable with low priority', () => {
      const err = new Error('rate limit exceeded');
      err.status = 429;
      const c = TrustlineErrorRecovery.classifyError(err);
      expect(c.type).toBe('rate_limit');
      expect(c.retryable).toBe(true);
      expect(c.priority).toBe('low');
    });

    test('should classify HTTP 401 as auth_error (non-retryable)', () => {
      const err = new Error('unauthorized');
      err.status = 401;
      const c = TrustlineErrorRecovery.classifyError(err);
      expect(c.type).toBe('auth_error');
      expect(c.retryable).toBe(false);
    });

    test('should classify HTTP 403 as auth_error (non-retryable)', () => {
      const err = new Error('forbidden');
      err.status = 403;
      const c = TrustlineErrorRecovery.classifyError(err);
      expect(c.type).toBe('auth_error');
      expect(c.retryable).toBe(false);
    });

    test('should classify client errors (4xx) as non-retryable', () => {
      const err = new Error('bad request');
      err.status = 400;
      const c = TrustlineErrorRecovery.classifyError(err);
      expect(c.type).toBe('client_error');
      expect(c.retryable).toBe(false);
    });

    test('should classify 5xx server errors as retryable', () => {
      const err = new Error('internal server error');
      err.status = 500;
      const c = TrustlineErrorRecovery.classifyError(err);
      expect(c.type).toBe('server_error');
      expect(c.retryable).toBe(true);
    });

    test('should classify db schema conflict as non-retryable', () => {
      const err = new Error('index already exists');
      const c = TrustlineErrorRecovery.classifyError(err);
      expect(c.type).toBe('db_schema_conflict');
      expect(c.retryable).toBe(false);
    });

    test('should classify unknown errors as cautiously retryable', () => {
      const err = new Error('something weird happened');
      const c = TrustlineErrorRecovery.classifyError(err);
      expect(c.type).toBe('unknown');
      expect(c.retryable).toBe(true);
    });
  });

  describe('TrustlineErrorRecovery – per-context circuit breakers', () => {
    test('should open circuit breaker after threshold failures on a context', async () => {
      vi.spyOn(TrustlineErrorRecovery, 'sleep').mockResolvedValue(undefined);
      const ctx = 'test-context-cb';
      const failingOp = vi.fn().mockRejectedValue(new Error('server error'));

      // Each call exhausts MAX_RETRY_ATTEMPTS, recording one failure per call
      for (let i = 0; i < 5; i++) {
        await expect(
          TrustlineErrorRecovery.executeWithRecovery(failingOp, ctx),
        ).rejects.toThrow();
      }

      await expect(
        TrustlineErrorRecovery.executeWithRecovery(failingOp, ctx),
      ).rejects.toThrow('Circuit breaker is open');

      vi.restoreAllMocks();
    });

    test('should isolate circuit breakers per context', async () => {
      vi.spyOn(TrustlineErrorRecovery, 'sleep').mockResolvedValue(undefined);
      const failingOp = vi.fn().mockRejectedValue(new Error('server error'));

      // Open the circuit for context A
      for (let i = 0; i < 5; i++) {
        await expect(
          TrustlineErrorRecovery.executeWithRecovery(failingOp, 'context-A'),
        ).rejects.toThrow();
      }

      // Context B should still be operational
      const successOp = vi.fn().mockResolvedValue('ok');
      const result = await TrustlineErrorRecovery.executeWithRecovery(successOp, 'context-B');
      expect(result).toBe('ok');

      vi.restoreAllMocks();
    });

    test('isCircuitBreakerOpen returns false when breaker is closed', () => {
      expect(TrustlineErrorRecovery.isCircuitBreakerOpen('fresh-context')).toBe(false);
    });

    test('resetCircuitBreaker(context) clears only that context', async () => {
      vi.spyOn(TrustlineErrorRecovery, 'sleep').mockResolvedValue(undefined);
      const failingOp = vi.fn().mockRejectedValue(new Error('server error'));

      for (let i = 0; i < 5; i++) {
        await expect(
          TrustlineErrorRecovery.executeWithRecovery(failingOp, 'ctx-reset'),
        ).rejects.toThrow();
      }

      expect(TrustlineErrorRecovery.isCircuitBreakerOpen('ctx-reset')).toBe(true);
      TrustlineErrorRecovery.resetCircuitBreaker('ctx-reset');
      expect(TrustlineErrorRecovery.isCircuitBreakerOpen('ctx-reset')).toBe(false);

      vi.restoreAllMocks();
    });

    test('getCircuitBreakerMetrics returns state snapshots', async () => {
      vi.spyOn(TrustlineErrorRecovery, 'sleep').mockResolvedValue(undefined);
      const failingOp = vi.fn().mockRejectedValue(new Error('server error'));

      await expect(
        TrustlineErrorRecovery.executeWithRecovery(failingOp, 'metrics-ctx'),
      ).rejects.toThrow();

      const metrics = TrustlineErrorRecovery.getCircuitBreakerMetrics();
      expect(metrics['metrics-ctx']).toBeDefined();
      expect(metrics['metrics-ctx'].metrics.totalFailures).toBeGreaterThan(0);

      vi.restoreAllMocks();
    });
  });

  describe('TrustlineErrorRecovery – half-open circuit breaker', () => {
    test('should allow a probe after timeout and close on success', async () => {
      vi.spyOn(TrustlineErrorRecovery, 'sleep').mockResolvedValue(undefined);
      const ctx = 'half-open-ctx';
      const failingOp = vi.fn().mockRejectedValue(new Error('server error'));

      // Force open
      for (let i = 0; i < 5; i++) {
        await expect(
          TrustlineErrorRecovery.executeWithRecovery(failingOp, ctx),
        ).rejects.toThrow();
      }

      // Manually advance the state to half-open by mutating internal state
      const state = TrustlineErrorRecovery._getState(ctx);
      state.state = 'half-open';

      const successOp = vi.fn().mockResolvedValue('recovered');
      const result = await TrustlineErrorRecovery.executeWithRecovery(successOp, ctx);
      expect(result).toBe('recovered');
      expect(state.state).toBe('closed');

      vi.restoreAllMocks();
    });

    test('should reopen circuit if half-open probe fails', async () => {
      vi.spyOn(TrustlineErrorRecovery, 'sleep').mockResolvedValue(undefined);
      const ctx = 'half-open-fail-ctx';
      const failingOp = vi.fn().mockRejectedValue(new Error('server error'));

      for (let i = 0; i < 5; i++) {
        await expect(
          TrustlineErrorRecovery.executeWithRecovery(failingOp, ctx),
        ).rejects.toThrow();
      }

      const state = TrustlineErrorRecovery._getState(ctx);
      state.state = 'half-open';

      await expect(
        TrustlineErrorRecovery.executeWithRecovery(failingOp, ctx),
      ).rejects.toThrow();

      expect(state.state).toBe('open');

      vi.restoreAllMocks();
    });
  });

  describe('TrustlineErrorRecovery – probe concurrency and null errors', () => {
    test('should allow only one concurrent half-open probe', async () => {
      const ctx = 'half-open-concurrent-ctx';
      const state = TrustlineErrorRecovery._getState(ctx);
      state.state = 'half-open';

      let release;
      const slowOp = vi.fn(() => new Promise((resolve) => { release = resolve; }));
      const probe = TrustlineErrorRecovery.executeWithRecovery(slowOp, ctx);

      await expect(
        TrustlineErrorRecovery.executeWithRecovery(vi.fn(), ctx),
      ).rejects.toThrow(/Circuit breaker is open/);

      release('ok');
      await expect(probe).resolves.toBe('ok');
      expect(state.state).toBe('closed');
      expect(state.probeInFlight).toBe(false);
    });

    test('should only count recoveries after prior failures', async () => {
      const ctx = 'recovery-count-ctx';
      await TrustlineErrorRecovery.executeWithRecovery(async () => 'ok', ctx);
      expect(TrustlineErrorRecovery._getState(ctx).metrics.totalRecoveries).toBe(0);
    });

    test('should classify and enhance null errors without throwing', () => {
      const errorClass = TrustlineErrorRecovery.classifyError(null);
      expect(errorClass.type).toBe('unknown');
      const enhanced = TrustlineErrorRecovery.enhanceError(null, 'ctx', 1, errorClass);
      expect(enhanced.status).toBe(500);
    });
  });

  describe('TrustlineErrorRecovery – operation timeout', () => {
    test('withTimeout rejects after the specified delay', async () => {
      const neverResolves = new Promise(() => {});
      await expect(
        TrustlineErrorRecovery.withTimeout(neverResolves, 50, 'slow op'),
      ).rejects.toThrow('slow op timed out after 50ms');
    });

    test('withTimeout resolves if operation completes in time', async () => {
      const fast = Promise.resolve('quick');
      await expect(
        TrustlineErrorRecovery.withTimeout(fast, 1000, 'fast op'),
      ).resolves.toBe('quick');
    });
  });

  describe('TrustlineErrorRecovery – dead-letter queue', () => {
    test('should push non-retryable failures to the DLQ', async () => {
      const err = new Error('asset not found');
      err.status = 404;
      const failingOp = vi.fn().mockRejectedValue(err);

      await expect(
        TrustlineErrorRecovery.executeWithRecovery(failingOp, 'dlq-ctx'),
      ).rejects.toThrow();

      const dlq = TrustlineErrorRecovery.getDeadLetterQueue();
      expect(dlq.length).toBeGreaterThan(0);
      expect(dlq[0].context).toBe('dlq-ctx');
      expect(dlq[0].errorType).toBe('asset_not_found');
    });

    test('drainDeadLetterQueue returns all entries and empties the queue', async () => {
      const err = new Error('asset not found');
      err.status = 404;
      const failingOp = vi.fn().mockRejectedValue(err);
      await expect(
        TrustlineErrorRecovery.executeWithRecovery(failingOp, 'drain-ctx'),
      ).rejects.toThrow();

      const drained = TrustlineErrorRecovery.drainDeadLetterQueue();
      expect(drained.length).toBeGreaterThan(0);
      expect(TrustlineErrorRecovery.getDeadLetterQueue()).toHaveLength(0);
    });
  });

  describe('TrustlineErrorRecovery – fallback handler', () => {
    test('should return fallback value when all attempts fail', async () => {
      vi.spyOn(TrustlineErrorRecovery, 'sleep').mockResolvedValue(undefined);
      const err = new Error('network error');
      const failingOp = vi.fn().mockRejectedValue(err);
      const fallback = vi.fn().mockResolvedValue('cached-data');

      const result = await TrustlineErrorRecovery.executeWithRecovery(
        failingOp,
        'fallback-ctx',
        { fallback },
      );

      expect(result).toBe('cached-data');
      expect(fallback).toHaveBeenCalledTimes(1);

      vi.restoreAllMocks();
    });

    test('should return fallback value when circuit breaker is open', async () => {
      vi.spyOn(TrustlineErrorRecovery, 'sleep').mockResolvedValue(undefined);
      const ctx = 'cb-fallback-ctx';
      const failingOp = vi.fn().mockRejectedValue(new Error('server error'));

      for (let i = 0; i < 5; i++) {
        await expect(
          TrustlineErrorRecovery.executeWithRecovery(failingOp, ctx),
        ).rejects.toThrow();
      }

      const fallback = vi.fn().mockResolvedValue('degraded-response');
      const result = await TrustlineErrorRecovery.executeWithRecovery(
        failingOp,
        ctx,
        { fallback },
      );

      expect(result).toBe('degraded-response');
      expect(fallback).toHaveBeenCalledTimes(1);

      vi.restoreAllMocks();
    });
  });

  describe('TrustlineErrorRecovery – retry delay', () => {
    test('should produce strictly increasing delays with exponential backoff', () => {
      // Use a fixed seed by mocking Math.random to return 0 (no jitter)
      vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter = 0
      const d1 = TrustlineErrorRecovery.calculateRetryDelay(1, 'high');
      const d2 = TrustlineErrorRecovery.calculateRetryDelay(2, 'high');
      const d3 = TrustlineErrorRecovery.calculateRetryDelay(3, 'high');

      expect(d2).toBeGreaterThan(d1);
      expect(d3).toBeGreaterThan(d2);
      expect(d3).toBeLessThanOrEqual(30000);

      vi.restoreAllMocks();
    });
  });
});

describe('Trustline Manager - Task #596: SQL Query Optimization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('TrustlineQueryOptimizer', () => {
    test('should get merchant allowed assets', async () => {
      const merchantId = 'merchant_123';
      const mockResult = {
        rows: [{
          id: merchantId,
          allowed_issuers: ['GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'],
          payment_limits: { USDC: { min: 1, max: 10000 } },
          issuer_count: 1
        }]
      };

      queryWithRetry.mockResolvedValue(mockResult);

      const result = await TrustlineQueryOptimizer.getMerchantAllowedAssets(merchantId);

      expect(result).toBe(mockResult);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [merchantId]
      );
    });

    test('should get payment statistics by asset', async () => {
      const merchantId = 'merchant_123';
      const mockResult = {
        rows: [{
          asset: 'USDC',
          asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          payment_count: 10,
          total_volume: 1000,
          avg_amount: 100,
          confirmed_count: 8,
          pending_count: 1,
          failed_count: 1
        }]
      };

      queryWithRetry.mockResolvedValue(mockResult);

      const result = await TrustlineQueryOptimizer.getPaymentStatsByAsset(merchantId);

      expect(result).toBe(mockResult);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('GROUP BY p.asset, p.asset_issuer'),
        [merchantId, '24 hours']
      );
    });

    test('should sanitize unsupported timeframes when getting payment statistics', async () => {
      const merchantId = 'merchant_123';
      queryWithRetry.mockResolvedValue({ rows: [] });

      await TrustlineQueryOptimizer.getPaymentStatsByAsset(
        merchantId,
        "1 hour'; DROP TABLE payments; --",
      );

      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('$2::interval'),
        [merchantId, '24 hours']
      );
    });

    test('should find payments by asset with filters', async () => {
      const merchantId = 'merchant_123';
      const assetCode = 'USDC';
      const assetIssuer = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
      const options = {
        status: 'confirmed',
        limit: 50,
        offset: 0
      };

      const mockResult = {
        rows: [{
          id: 'payment_123',
          amount: 100,
          asset: assetCode,
          asset_issuer: assetIssuer,
          status: 'confirmed'
        }]
      };

      queryWithRetry.mockResolvedValue(mockResult);

      const result = await TrustlineQueryOptimizer.findPaymentsByAsset(
        merchantId, 
        assetCode, 
        assetIssuer, 
        options
      );

      expect(result).toBe(mockResult);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining([merchantId, assetCode, assetIssuer, 'confirmed', 50, 0])
      );
    });

    test('should get trustline health metrics', async () => {
      const merchantId = 'merchant_123';
      const mockResult = {
        rows: [{
          asset: 'USDC',
          asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          total_payments: 100,
          failed_payments: 5,
          failure_rate_percent: 5.0,
          avg_completion_time: 30,
          issuer_allowed: true
        }]
      };

      queryWithRetry.mockResolvedValue(mockResult);

      const result = await TrustlineQueryOptimizer.getTrustlineHealthMetrics(merchantId);

      expect(result).toBe(mockResult);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('WITH asset_stats AS'),
        [merchantId]
      );
    });

    test('should create optimized indexes', async () => {
      queryWithRetry.mockResolvedValue({ rows: [] });

      const result = await TrustlineQueryOptimizer.createOptimizedIndexes();

      expect(result).toHaveLength(7); // 4 original + 3 added in Task #879
      expect(result.every(r => r.success)).toBe(true);
      expect(mockQueryWithRetry).toHaveBeenCalledTimes(7);
    });

    test('should handle index creation errors gracefully', async () => {
      queryWithRetry
        .mockResolvedValueOnce({ rows: [] }) // First index succeeds
        .mockRejectedValueOnce(new Error('Index already exists')) // Second fails
        .mockResolvedValueOnce({ rows: [] }) // Third succeeds
        .mockResolvedValueOnce({ rows: [] }) // Fourth succeeds
        .mockResolvedValueOnce({ rows: [] }) // Fifth succeeds
        .mockResolvedValueOnce({ rows: [] }) // Sixth succeeds
        .mockResolvedValueOnce({ rows: [] }); // Seventh succeeds

      const result = await TrustlineQueryOptimizer.createOptimizedIndexes();

      expect(result).toHaveLength(7);
      expect(result[0].success).toBe(true);
      expect(result[1].success).toBe(false);
      expect(result[1].error).toContain('Index already exists');
      expect(result[2].success).toBe(true);
      expect(result[3].success).toBe(true);
    });
  });
});

describe('Trustline Manager - Integration Tests', () => {
  let manager;

  beforeEach(() => {
    manager = new TrustlineManager();
    vi.clearAllMocks();
  });

  test('should verify trustline transaction with all enhancements', async () => {
    const txHash = 'integration_test_hash';
    
    verifyTransactionSignature.mockResolvedValue({
      valid: true,
      reason: 'Signature verification passed',
      isMultiSig: false,
      signatureCount: 1,
      thresholdMet: true
    });

    withHorizonRetry.mockResolvedValue({
      envelope_xdr: 'mock_xdr'
    });

    StellarSdk.Transaction.mockImplementation(() => ({
      operations: [{
        type: 'changeTrust',
        asset: {
          isNative: () => false,
          getCode: () => 'USDC',
          getIssuer: () => 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
        },
        limit: '1000'
      }]
    }));

    isValidAssetCode.mockReturnValue(true);
    isValidStellarAccountId.mockReturnValue(true);

    const result = await manager.verifyTrustlineTransaction(txHash);

    expect(result.valid).toBe(true);
    expect(result.trustlineSpecific).toBe(true);
  });

  test('should get merchant trustline configuration', async () => {
    const merchantId = 'merchant_123';
    
    queryWithRetry
      .mockResolvedValueOnce({
        rows: [{
          id: merchantId,
          allowed_issuers: ['GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'],
          payment_limits: { USDC: { min: 1, max: 10000 } }
        }]
      })
      .mockResolvedValueOnce({
        rows: [{
          asset: 'USDC',
          total_payments: 100,
          failure_rate_percent: 2.0
        }]
      });

    const result = await manager.getMerchantTrustlineConfig(merchantId);

    expect(result.merchant).toBeDefined();
    expect(result.healthMetrics).toBeDefined();
    expect(result.timestamp).toBeDefined();
  });

  test('should initialize with database optimizations', async () => {
    queryWithRetry.mockResolvedValue({ rows: [] });

    const result = await manager.initialize();

    expect(result.success).toBe(true);
    expect(result.indexResults).toBeDefined();
  });

  test('should handle initialization errors gracefully', async () => {
    queryWithRetry.mockRejectedValue(new Error('Database connection failed'));

    const result = await manager.initialize();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Database connection failed');
  });

  test('initialization logs through the structured logger instead of console', async () => {
    const { logger } = await import('./logger.js');
    vi.clearAllMocks();

    queryWithRetry.mockResolvedValue({ rows: [] });
    const ok = await manager.initialize();
    expect(ok.success).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ indexResults: expect.any(Array) }),
      'Trustline Manager initialized with database optimizations',
    );

    queryWithRetry.mockRejectedValue(new Error('Database connection failed'));
    const failed = await manager.initialize();
    expect(failed.success).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'trustline-manager.initialize' }),
      'Failed to initialize Trustline Manager',
    );
  });
});

describe('Trustline Manager - Singleton Instance', () => {
  test('should export singleton instance', () => {
    expect(trustlineManager).toBeInstanceOf(TrustlineManager);
  });

  test('should have all required components', () => {
    expect(trustlineManager.signatureVerifier).toBeInstanceOf(TrustlineSignatureVerifier);
    expect(trustlineManager.rateLimiter).toBe(TrustlineRateLimiter);
    expect(trustlineManager.errorRecovery).toBe(TrustlineErrorRecovery);
    expect(trustlineManager.queryOptimizer).toBe(TrustlineQueryOptimizer);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting – Enhanced Coverage (Task #594)
// ─────────────────────────────────────────────────────────────────────────────

describe('TrustlineRateLimiter – Internal Service Bypass', () => {
  const TOKEN = 'super-secret-internal-token';

  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
  });

  test('returns true when header matches configured token', () => {
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
    const req = { headers: { 'x-internal-service-token': TOKEN } };
    expect(TrustlineRateLimiter.isInternalService(req)).toBe(true);
  });

  test('returns false when header token is wrong', () => {
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
    const req = { headers: { 'x-internal-service-token': 'wrong' } };
    expect(TrustlineRateLimiter.isInternalService(req)).toBe(false);
  });

  test('returns false when header is absent', () => {
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
    const req = { headers: {} };
    expect(TrustlineRateLimiter.isInternalService(req)).toBe(false);
  });

  test('returns false when INTERNAL_SERVICE_TOKEN env var is not set', () => {
    const req = { headers: { 'x-internal-service-token': TOKEN } };
    expect(TrustlineRateLimiter.isInternalService(req)).toBe(false);
  });

  test('returns false for a null/undefined request', () => {
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
    expect(TrustlineRateLimiter.isInternalService(null)).toBe(false);
    expect(TrustlineRateLimiter.isInternalService(undefined)).toBe(false);
  });
});

describe('TrustlineRateLimiter – Violation Metrics', () => {
  beforeEach(() => {
    TrustlineRateLimiter.resetViolationMetrics();
    vi.clearAllMocks();
  });

  test('getRateLimitViolationMetrics returns empty object initially', () => {
    expect(TrustlineRateLimiter.getRateLimitViolationMetrics()).toEqual({});
  });

  test('recordViolation increments count and sets lastSeen', () => {
    const key = 'trustline:ops:merchant:abc';
    TrustlineRateLimiter.recordViolation(key);
    TrustlineRateLimiter.recordViolation(key);

    const metrics = TrustlineRateLimiter.getRateLimitViolationMetrics();
    expect(metrics[key].count).toBe(2);
    expect(metrics[key].lastSeen).toBeTruthy();
  });

  test('tracks multiple keys independently', () => {
    TrustlineRateLimiter.recordViolation('key-a');
    TrustlineRateLimiter.recordViolation('key-b');
    TrustlineRateLimiter.recordViolation('key-b');

    const metrics = TrustlineRateLimiter.getRateLimitViolationMetrics();
    expect(metrics['key-a'].count).toBe(1);
    expect(metrics['key-b'].count).toBe(2);
  });

  test('resetViolationMetrics clears all data', () => {
    TrustlineRateLimiter.recordViolation('some-key');
    TrustlineRateLimiter.resetViolationMetrics();
    expect(TrustlineRateLimiter.getRateLimitViolationMetrics()).toEqual({});
  });

  test('getRateLimitViolationMetrics returns a snapshot copy', () => {
    TrustlineRateLimiter.recordViolation('copy-key');
    const snapshot = TrustlineRateLimiter.getRateLimitViolationMetrics();
    // Mutating the snapshot should not affect stored metrics
    snapshot['copy-key'].count = 9999;
    expect(TrustlineRateLimiter.getRateLimitViolationMetrics()['copy-key'].count).toBe(1);
  });

  test('violation tracking stays bounded under many unique keys', () => {
    for (let i = 0; i < 10050; i++) {
      TrustlineRateLimiter.recordViolation(`flood-${i}`);
    }
    const metrics = TrustlineRateLimiter.getRateLimitViolationMetrics();
    expect(Object.keys(metrics).length).toBe(10000);
    expect(metrics['flood-0']).toBeUndefined();
    expect(metrics['flood-10049']).toBeDefined();
  });
});

describe('TrustlineSignatureVerifier - cache bounds', () => {
  test('evicts oldest and expired entries to stay bounded', () => {
    const verifier = new TrustlineSignatureVerifier();
    const now = Date.now();
    verifier.verificationCache.set('expired', { result: {}, timestamp: now - verifier.cacheTimeout - 1 });
    for (let i = 0; i < 1000; i++) {
      verifier.verificationCache.set(`k${i}`, { result: {}, timestamp: now });
    }
    verifier._pruneCache();
    expect(verifier.verificationCache.has('expired')).toBe(false);
    expect(verifier.verificationCache.size).toBeLessThan(1000);
    expect(verifier.verificationCache.has('k0')).toBe(false);
    expect(verifier.verificationCache.has('k999')).toBe(true);
  });
});

describe('TrustlineRateLimiter - internal token comparison', () => {
  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
  });

  test('rejects tokens of a different length and non-string values', () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'secret-token';
    expect(TrustlineRateLimiter.isInternalService({ headers: { 'x-internal-service-token': 'secret' } })).toBe(false);
    expect(TrustlineRateLimiter.isInternalService({ headers: { 'x-internal-service-token': ['secret-token'] } })).toBe(false);
    expect(TrustlineRateLimiter.isInternalService({ headers: { 'x-internal-service-token': 'secret-token' } })).toBe(true);
  });
});

describe('TrustlineRateLimiter – Burst Rate Limiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TrustlineRateLimiter.resetViolationMetrics();
  });

  test('creates burst limiter with correct window and max', () => {
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineBurstRateLimit({ store: {}, rateLimitFactory });

    expect(rateLimitFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        windowMs: TRUSTLINE_BURST_WINDOW_MS,
        max: TRUSTLINE_BURST_MAX,
        keyGenerator: TrustlineRateLimiter.getTrustlineOperationKey,
      }),
    );
  });

  test('burst limiter uses the operations key generator', () => {
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineBurstRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    expect(config.keyGenerator).toBe(TrustlineRateLimiter.getTrustlineOperationKey);
  });

  test('burst limiter skip function allows internal services', () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'svc-token';
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineBurstRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    const req = { headers: { 'x-internal-service-token': 'svc-token' } };
    expect(config.skip(req)).toBe(true);
    delete process.env.INTERNAL_SERVICE_TOKEN;
  });

  test('burst limiter skip function does NOT skip normal clients', () => {
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineBurstRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    const req = { merchant: { id: 'merchant-1' }, headers: {} };
    expect(config.skip(req)).toBe(false);
  });

  test('burst limiter handler records violation and returns 429 response', () => {
    const rateLimitFactory = mockRateLimit;
    mockIpKeyGenerator.mockReturnValue('1.2.3.4');
    TrustlineRateLimiter.createTrustlineBurstRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    const req = { ip: '1.2.3.4', headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const options = { statusCode: 429, message: { error: 'Burst limit exceeded.' } };

    config.handler(req, res, vi.fn(), options);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(options.message);

    const metrics = TrustlineRateLimiter.getRateLimitViolationMetrics();
    const key = 'trustline:ops:ip:1.2.3.4';
    expect(metrics[key]).toBeDefined();
    expect(metrics[key].count).toBe(1);
  });

  test('burst limiter has passOnStoreError enabled', () => {
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineBurstRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    expect(config.passOnStoreError).toBe(true);
  });

  test('burst limit error message includes TRUSTLINE_BURST_LIMIT code', () => {
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineBurstRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    expect(config.message.code).toBe('TRUSTLINE_BURST_LIMIT');
  });
});

describe('TrustlineRateLimiter – Enhanced Operation Rate Limiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TrustlineRateLimiter.resetViolationMetrics();
    delete process.env.INTERNAL_SERVICE_TOKEN;
  });

  test('skip function returns true for internal services', () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'int-svc';
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineOperationRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    const req = { merchant: { metadata: { tier: 'basic' } }, headers: { 'x-internal-service-token': 'int-svc' } };
    expect(config.skip(req)).toBe(true);
    delete process.env.INTERNAL_SERVICE_TOKEN;
  });

  test('skip function returns true for enterprise merchants', () => {
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineOperationRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    expect(config.skip({ merchant: { metadata: { tier: 'enterprise' } }, headers: {} })).toBe(true);
  });

  test('skip function returns true for premium merchants', () => {
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineOperationRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    expect(config.skip({ merchant: { metadata: { tier: 'premium' } }, headers: {} })).toBe(true);
  });

  test('skip function returns false for basic-tier merchants', () => {
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineOperationRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    expect(config.skip({ merchant: { metadata: { tier: 'basic' } }, headers: {} })).toBe(false);
  });

  test('skip function returns false for unauthenticated requests', () => {
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineOperationRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    expect(config.skip({ headers: {} })).toBe(false);
  });

  test('handler records violation and responds with 429', () => {
    mockIpKeyGenerator.mockReturnValue('10.0.0.1');
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineOperationRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    const req = { ip: '10.0.0.1', headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const options = { statusCode: 429, message: { error: 'Too many trustline operations.', code: 'TRUSTLINE_RATE_LIMIT' } };

    config.handler(req, res, vi.fn(), options);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(options.message);
    const metrics = TrustlineRateLimiter.getRateLimitViolationMetrics();
    expect(metrics['trustline:ops:ip:10.0.0.1'].count).toBe(1);
  });

  test('error message includes TRUSTLINE_RATE_LIMIT code', () => {
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineOperationRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    expect(config.message.code).toBe('TRUSTLINE_RATE_LIMIT');
  });

  test('configures correct window and max values', () => {
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineOperationRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    expect(config.windowMs).toBe(TRUSTLINE_RATE_LIMIT_WINDOW_MS);
    expect(config.max).toBe(TRUSTLINE_RATE_LIMIT_MAX);
  });
});

describe('TrustlineRateLimiter – Enhanced Verification Rate Limiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TrustlineRateLimiter.resetViolationMetrics();
    delete process.env.INTERNAL_SERVICE_TOKEN;
  });

  test('configures higher max than operation limiter', () => {
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineVerificationRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    expect(config.max).toBe(TRUSTLINE_VERIFICATION_RATE_LIMIT_MAX);
    expect(config.max).toBeGreaterThan(TRUSTLINE_RATE_LIMIT_MAX);
  });

  test('skip function allows internal services', () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'svc';
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineVerificationRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    const req = { headers: { 'x-internal-service-token': 'svc' } };
    expect(config.skip(req)).toBe(true);
    delete process.env.INTERNAL_SERVICE_TOKEN;
  });

  test('handler records violation and responds with 429', () => {
    mockIpKeyGenerator.mockReturnValue('5.5.5.5');
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineVerificationRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    const req = { ip: '5.5.5.5', headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const options = { statusCode: 429, message: { error: 'Too many verification requests.' } };

    config.handler(req, res, vi.fn(), options);

    expect(res.status).toHaveBeenCalledWith(429);
    const metrics = TrustlineRateLimiter.getRateLimitViolationMetrics();
    expect(metrics['trustline:verify:ip:5.5.5.5'].count).toBe(1);
  });

  test('error message includes TRUSTLINE_VERIFY_RATE_LIMIT code', () => {
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineVerificationRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    expect(config.message.code).toBe('TRUSTLINE_VERIFY_RATE_LIMIT');
  });

  test('uses verification key generator (not operations key)', () => {
    const rateLimitFactory = mockRateLimit;
    TrustlineRateLimiter.createTrustlineVerificationRateLimit({ store: {}, rateLimitFactory });

    const config = rateLimitFactory.mock.calls[0][0];
    expect(config.keyGenerator).toBe(TrustlineRateLimiter.getTrustlineVerificationKey);
  });
});

describe('TrustlineRateLimiter – Key Generation Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('operation key prefers merchantId over API key and IP', () => {
    const req = {
      merchant: { id: 'merch-xyz' },
      headers: { 'x-api-key': 'somekey' },
      ip: '9.9.9.9',
    };
    const key = TrustlineRateLimiter.getTrustlineOperationKey(req);
    expect(key).toBe('trustline:ops:merchant:merch-xyz');
  });

  test('operation key prefers hashed API key over IP when no merchant', () => {
    mockIpKeyGenerator.mockReturnValue('2.2.2.2');
    const req = { headers: { 'x-api-key': 'testkey' }, ip: '2.2.2.2' };
    const key = TrustlineRateLimiter.getTrustlineOperationKey(req);
    expect(key).toMatch(/^trustline:ops:api:[a-f0-9]{16}$/);
  });

  test('operation key falls back to IP when no merchant or API key', () => {
    mockIpKeyGenerator.mockReturnValue('3.3.3.3');
    const req = { ip: '3.3.3.3', headers: {} };
    const key = TrustlineRateLimiter.getTrustlineOperationKey(req);
    expect(key).toBe('trustline:ops:ip:3.3.3.3');
  });

  test('operation key uses socket remote address as fallback for IP', () => {
    mockIpKeyGenerator.mockReturnValue('7.7.7.7');
    const req = { socket: { remoteAddress: '7.7.7.7' }, headers: {} };
    const key = TrustlineRateLimiter.getTrustlineOperationKey(req);
    expect(key).toBe('trustline:ops:ip:7.7.7.7');
  });

  test('operation key uses unknown-ip when no address available', () => {
    mockIpKeyGenerator.mockReturnValue('unknown-ip');
    const key = TrustlineRateLimiter.getTrustlineOperationKey({});
    expect(key).toBe('trustline:ops:ip:unknown-ip');
  });

  test('verification key uses merchantId when present', () => {
    const req = { merchant: { id: 'verif-m' } };
    const key = TrustlineRateLimiter.getTrustlineVerificationKey(req);
    expect(key).toBe('trustline:verify:merchant:verif-m');
  });

  test('verification key falls back to IP', () => {
    mockIpKeyGenerator.mockReturnValue('8.8.8.8');
    const req = { ip: '8.8.8.8' };
    const key = TrustlineRateLimiter.getTrustlineVerificationKey(req);
    expect(key).toBe('trustline:verify:ip:8.8.8.8');
  });

  test('hashed API keys are truncated to 16 hex characters', () => {
    mockIpKeyGenerator.mockReturnValue('0.0.0.0');
    const req = { headers: { 'x-api-key': 'a-very-long-api-key-value' }, ip: '0.0.0.0' };
    const key = TrustlineRateLimiter.getTrustlineOperationKey(req);
    const hashPart = key.replace('trustline:ops:api:', '');
    expect(hashPart).toHaveLength(16);
    expect(hashPart).toMatch(/^[a-f0-9]+$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Granular Metrics Integration (issue #1043)
// ─────────────────────────────────────────────────────────────────────────────

describe('TrustlineManager – granular metrics integration', () => {
  let trustlineManagerRegister;

  beforeEach(async () => {
    const metrics = await import('./trustline-manager-metrics.js');
    trustlineManagerRegister = metrics.trustlineManagerRegister;
    metrics.resetTrustlineManagerMetrics();
    TrustlineErrorRecovery.resetCircuitBreaker();
    vi.clearAllMocks();
  });

  test('records invalid signature verification outcome', async () => {
    mockVerifyTransactionSignature.mockResolvedValue({
      valid: false,
      reason: 'Invalid signature',
      isMultiSig: false,
      signatureCount: 0,
      thresholdMet: false,
    });

    const verifier = new TrustlineSignatureVerifier();
    const result = await verifier.verifyTrustlineSignature('bad_tx_hash');

    expect(result.valid).toBe(false);
    const text = await trustlineManagerRegister.metrics();
    expect(text).toContain('trustline_signature_verifications_total{outcome="invalid"} 1');
  });

  test('publishes circuit breaker state after failures', async () => {
    const failingOp = vi.fn().mockRejectedValue(new Error('network error'));

    for (let i = 0; i < 5; i++) {
      await expect(
        TrustlineErrorRecovery.executeWithRecovery(failingOp, 'metrics-cb-ctx', {
          maxAttempts: 1,
        }),
      ).rejects.toThrow();
    }

    const text = await trustlineManagerRegister.metrics();
    expect(text).toContain('trustline_circuit_breaker_open{context="metrics-cb-ctx"} 1');
    expect(text).toContain(
      'trustline_error_recovery_total{context="metrics-cb-ctx",outcome="failure"} 5',
    );
  });
});
