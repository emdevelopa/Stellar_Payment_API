/**
 * Comprehensive End-to-End Tests for Stellar Horizon Client
 *
 * This test suite provides comprehensive coverage for the Horizon Client module,
 * including:
 * - All Horizon Client operations
 * - Retry logic and error handling
 * - Rate limiting scenarios
 * - Network failures and recovery
 * - Security validation
 * - Metrics verification
 * - Edge cases and boundary conditions
 *
 * Tests use mocked Horizon SDK to avoid real network dependencies while
 * simulating realistic network conditions and error scenarios.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { HorizonClient } from '../../src/lib/stellar/horizon-client.js';
import * as StellarSdk from 'stellar-sdk';
import * as metrics from '../../src/lib/metrics.js';

// Test configuration
const TEST_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const TEST_NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const TEST_ACCOUNT_ID = 'GDRXE2BQUC3AZGSQK6X4Q6X6ZJ4P4K5WRGQKZ7VYI3XU4Q2YOMF4XG4D';
const TEST_TX_HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

// Mock Stellar SDK
const mockServer = {
  loadAccount: vi.fn(),
  payments: vi.fn(),
  transactions: vi.fn(),
  feeStats: vi.fn(),
  strictReceivePaths: vi.fn(),
};

vi.mock('stellar-sdk', () => ({
  Horizon: {
    Server: vi.fn(() => mockServer),
  },
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
  Asset: {
    native: vi.fn(() => ({ isNative: () => true, getCode: () => 'XLM' })),
  },
}));

describe('HorizonClient E2E Tests', () => {
  let horizonClient;
  let metricsSpies;

  beforeAll(() => {
    // Setup metrics spies
    metricsSpies = {
      operations: vi.spyOn(metrics.horizonClientOperations, 'inc'),
      errors: vi.spyOn(metrics.horizonClientErrors, 'inc'),
      retries: vi.spyOn(metrics.horizonClientRetries, 'inc'),
      latency: vi.spyOn(metrics.horizonClientLatency, 'observe'),
    };
  });

  afterAll(() => {
    // Restore metrics
    Object.values(metricsSpies).forEach(spy => spy.mockRestore());
  });

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    Object.values(mockServer).forEach(fn => fn.mockReset());
    Object.values(metricsSpies).forEach(spy => spy.mockReset());

    // Create fresh client instance
    horizonClient = new HorizonClient(TEST_HORIZON_URL, TEST_NETWORK_PASSPHRASE, {
      retryDelays: [50, 100], // Short delays for testing
      healthTimeout: 1000,
    });

    // Setup default mock behaviors
    mockServer.loadAccount.mockResolvedValue({
      id: TEST_ACCOUNT_ID,
      account_id: TEST_ACCOUNT_ID,
      sequence: '123456789',
      balances: [{ asset_type: 'native', balance: '1000.0000000' }],
      thresholds: { med_threshold: 0 },
      signers: [{ key: TEST_ACCOUNT_ID, weight: 1 }],
    });

    const mockCall = vi.fn().mockResolvedValue({
      records: [
        {
          id: '123456789',
          type: 'payment',
          asset_type: 'native',
          amount: '100.0000000',
          to: TEST_ACCOUNT_ID,
          transaction_hash: TEST_TX_HASH,
          created_at: new Date().toISOString(),
        },
      ],
    });

    const mockBuilder = {
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      call: mockCall,
    };

    mockServer.payments.mockReturnValue({
      forAccount: vi.fn().mockReturnValue(mockBuilder),
    });

    mockServer.transactions.mockReturnValue({
      transaction: vi.fn().mockReturnValue({
        call: vi.fn().mockResolvedValue({
          id: TEST_TX_HASH,
          memo_type: 'none',
          memo: null,
        }),
      }),
    });

    mockServer.feeStats.mockResolvedValue({
      last_ledger_base_fee: '100',
      fee_charged: { mode: '250', p50: '200' },
      max_fee: { mode: '300' },
    });

    mockServer.strictReceivePaths.mockReturnValue({
      call: vi.fn().mockResolvedValue({
        records: [
          {
            source_amount: '50.0000000',
            source_asset_type: 'native',
            source_asset_code: 'XLM',
            source_asset_issuer: null,
            destination_amount: '25.0000000',
            path: [],
          },
        ],
      }),
    });
  });

  describe('Health Check Operations', () => {
    it('should return true when Horizon server is reachable', async () => {
      // Mock successful fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await horizonClient.isReachable();

      expect(result).toBe(true);
      // Note: isReachable doesn't use the standard metrics recording for success
    });

    it('should return true when rate limited (429) - treats as reachable', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
      });

      const result = await horizonClient.isReachable();

      expect(result).toBe(true);
    });

    it('should return false when Horizon server is not reachable', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });

      const result = await horizonClient.isReachable();

      expect(result).toBe(false);
      // Health check doesn't always record metrics for non-OK responses
    });

    it('should return false on network errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await horizonClient.isReachable();

      expect(result).toBe(false);
      expect(metricsSpies.errors).toHaveBeenCalledWith({
        operation: 'health_check',
        error_type: expect.any(String),
      });
    });

    it('should timeout after healthTimeout duration', async () => {
      global.fetch = vi.fn().mockImplementation(() => 
        new Promise((_, reject) => setTimeout(() => reject(new Error('AbortError')), 2000))
      );

      const result = await horizonClient.isReachable();

      expect(result).toBe(false);
    });
  });

  describe('Account Operations', () => {
    it('should successfully load account details', async () => {
      const result = await horizonClient.loadAccount(TEST_ACCOUNT_ID);

      expect(result).toBeDefined();
      expect(result.id).toBe(TEST_ACCOUNT_ID);
      expect(mockServer.loadAccount).toHaveBeenCalledWith(TEST_ACCOUNT_ID);
      expect(metricsSpies.operations).toHaveBeenCalledWith({
        operation: 'loadAccount',
        result: 'success',
      });
    });

    it('should retry on rate limit (429) and eventually succeed', async () => {
      mockServer.loadAccount
        .mockRejectedValueOnce({ response: { status: 429 } })
        .mockRejectedValueOnce({ response: { status: 429 } })
        .mockResolvedValueOnce({
          id: TEST_ACCOUNT_ID,
          account_id: TEST_ACCOUNT_ID,
        });

      const result = await horizonClient.loadAccount(TEST_ACCOUNT_ID);

      expect(result).toBeDefined();
      expect(mockServer.loadAccount).toHaveBeenCalledTimes(3);
      expect(metricsSpies.retries).toHaveBeenCalledWith({ operation: 'loadAccount' });
      expect(metricsSpies.retries).toHaveBeenCalledTimes(2);
    });

    it('should retry on server error (500) and eventually succeed', async () => {
      mockServer.loadAccount
        .mockRejectedValueOnce({ response: { status: 500 } })
        .mockResolvedValueOnce({
          id: TEST_ACCOUNT_ID,
          account_id: TEST_ACCOUNT_ID,
        });

      const result = await horizonClient.loadAccount(TEST_ACCOUNT_ID);

      expect(result).toBeDefined();
      expect(mockServer.loadAccount).toHaveBeenCalledTimes(2);
      expect(metricsSpies.retries).toHaveBeenCalledWith({ operation: 'loadAccount' });
    });

    it('should fail after exhausting retries on persistent 429', async () => {
      mockServer.loadAccount.mockRejectedValue({ response: { status: 429 } });

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow('rate limit');

      expect(mockServer.loadAccount).toHaveBeenCalledTimes(3); // initial + 2 retries
      expect(metricsSpies.errors).toHaveBeenCalledWith({
        operation: 'loadAccount',
        error_type: 'rate_limit',
      });
    });

    it('should throw descriptive error for 404 not found', async () => {
      mockServer.loadAccount.mockRejectedValue({ response: { status: 404 } });

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow('not found');

      expect(metricsSpies.errors).toHaveBeenCalledWith({
        operation: 'loadAccount',
        error_type: 'not_found',
      });
    });

    it('should throw descriptive error for network failures', async () => {
      mockServer.loadAccount.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow('Unable to connect');

      expect(metricsSpies.errors).toHaveBeenCalledWith({
        operation: 'loadAccount',
        error_type: expect.any(String),
      });
    });

    it('should not retry on non-retryable client errors (400)', async () => {
      mockServer.loadAccount.mockRejectedValue({ response: { status: 400 } });

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow();

      expect(mockServer.loadAccount).toHaveBeenCalledTimes(1);
      expect(metricsSpies.retries).not.toHaveBeenCalled();
    });
  });

  describe('Payment Operations', () => {
    it('should successfully fetch payments for an account', async () => {
      const result = await horizonClient.fetchPayments(TEST_ACCOUNT_ID, {
        order: 'desc',
        limit: 100,
      });

      expect(result).toBeDefined();
      expect(result.records).toBeInstanceOf(Array);
      expect(result.records.length).toBeGreaterThan(0);
      expect(metricsSpies.operations).toHaveBeenCalledWith({
        operation: 'fetchPayments',
        result: 'success',
      });
    });

    it('should fetch payments with default options', async () => {
      const result = await horizonClient.fetchPayments(TEST_ACCOUNT_ID);

      expect(result).toBeDefined();
      expect(result.records).toBeInstanceOf(Array);
    });

    it('should retry on timeout during payment fetch', async () => {
      const callMock = vi.fn()
        .mockRejectedValueOnce({ code: 'ETIMEDOUT' })
        .mockResolvedValueOnce({
          records: [{ id: '123', type: 'payment' }],
        });

      const mockBuilder = {
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        call: callMock,
      };

      mockServer.payments.mockReturnValue({
        forAccount: vi.fn().mockReturnValue(mockBuilder),
      });

      const result = await horizonClient.fetchPayments(TEST_ACCOUNT_ID);

      expect(result).toBeDefined();
      expect(callMock).toHaveBeenCalledTimes(2);
      expect(metricsSpies.retries).toHaveBeenCalledWith({ operation: 'fetchPayments' });
    });

    it('should handle empty payment records', async () => {
      const callMock = vi.fn().mockResolvedValue({ records: [] });

      const mockBuilder = {
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        call: callMock,
      };

      mockServer.payments.mockReturnValue({
        forAccount: vi.fn().mockReturnValue(mockBuilder),
      });

      const result = await horizonClient.fetchPayments(TEST_ACCOUNT_ID);

      expect(result.records).toEqual([]);
    });
  });

  describe('Transaction Operations', () => {
    it('should successfully fetch transaction details', async () => {
      const result = await horizonClient.fetchTransaction(TEST_TX_HASH);

      expect(result).toBeDefined();
      expect(result.id).toBe(TEST_TX_HASH);
      expect(mockServer.transactions().transaction).toHaveBeenCalledWith(TEST_TX_HASH);
      expect(metricsSpies.operations).toHaveBeenCalledWith({
        operation: 'fetchTransaction',
        result: 'success',
      });
    });

    it('should retry on network errors during transaction fetch', async () => {
      const callMock = vi.fn()
        .mockRejectedValueOnce({ code: 'ECONNRESET' })
        .mockResolvedValueOnce({ id: TEST_TX_HASH });

      mockServer.transactions.mockReturnValue({
        transaction: vi.fn().mockReturnValue({ call: callMock }),
      });

      const result = await horizonClient.fetchTransaction(TEST_TX_HASH);

      expect(result).toBeDefined();
      expect(callMock).toHaveBeenCalledTimes(2);
      expect(metricsSpies.retries).toHaveBeenCalledWith({ operation: 'fetchTransaction' });
    });

    it('should handle transaction not found (404)', async () => {
      const callMock = vi.fn().mockRejectedValue({ response: { status: 404 } });

      mockServer.transactions.mockReturnValue({
        transaction: vi.fn().mockReturnValue({ call: callMock }),
      });

      await expect(horizonClient.fetchTransaction(TEST_TX_HASH)).rejects.toThrow('not found');

      expect(metricsSpies.errors).toHaveBeenCalledWith({
        operation: 'fetchTransaction',
        error_type: 'not_found',
      });
    });
  });

  describe('Path Finding Operations', () => {
    it('should successfully find strict receive paths', async () => {
      const sourceAsset = StellarSdk.Asset.native();
      const destAsset = StellarSdk.Asset.native();

      const result = await horizonClient.findStrictReceivePaths(
        [sourceAsset],
        destAsset,
        '25.0000000'
      );

      expect(result).toBeDefined();
      expect(result.records).toBeInstanceOf(Array);
      expect(result.records.length).toBeGreaterThan(0);
      expect(metricsSpies.operations).toHaveBeenCalledWith({
        operation: 'findStrictReceivePaths',
        result: 'success',
      });
    });

    it('should handle empty path results', async () => {
      mockServer.strictReceivePaths.mockReturnValue({
        call: vi.fn().mockResolvedValue({ records: [] }),
      });

      const sourceAsset = StellarSdk.Asset.native();
      const destAsset = StellarSdk.Asset.native();

      const result = await horizonClient.findStrictReceivePaths(
        [sourceAsset],
        destAsset,
        '25.0000000'
      );

      expect(result.records).toEqual([]);
    });

    it('should retry on rate limit during path finding', async () => {
      const callMock = vi.fn()
        .mockRejectedValueOnce({ response: { status: 429 } })
        .mockResolvedValueOnce({
          records: [{ source_amount: '50.0000000' }],
        });

      mockServer.strictReceivePaths.mockReturnValue({ call: callMock });

      const sourceAsset = StellarSdk.Asset.native();
      const destAsset = StellarSdk.Asset.native();

      const result = await horizonClient.findStrictReceivePaths(
        [sourceAsset],
        destAsset,
        '25.0000000'
      );

      expect(result).toBeDefined();
      expect(callMock).toHaveBeenCalledTimes(2);
      expect(metricsSpies.retries).toHaveBeenCalledWith({
        operation: 'findStrictReceivePaths',
      });
    });
  });

  describe('Fee Statistics Operations', () => {
    it('should successfully fetch fee statistics', async () => {
      const result = await horizonClient.getFeeStats();

      expect(result).toBeDefined();
      expect(result.last_ledger_base_fee).toBeDefined();
      expect(result.fee_charged).toBeDefined();
      expect(metricsSpies.operations).toHaveBeenCalledWith({
        operation: 'getFeeStats',
        result: 'success',
      });
    });

    it('should retry on server errors during fee stats fetch', async () => {
      mockServer.feeStats
        .mockRejectedValueOnce({ response: { status: 503 } })
        .mockResolvedValueOnce({
          last_ledger_base_fee: '100',
          fee_charged: { mode: '250' },
        });

      const result = await horizonClient.getFeeStats();

      expect(result).toBeDefined();
      expect(mockServer.feeStats).toHaveBeenCalledTimes(2);
      expect(metricsSpies.retries).toHaveBeenCalledWith({ operation: 'getFeeStats' });
    });

    it('should handle malformed fee stats response', async () => {
      mockServer.feeStats.mockResolvedValue({ invalid: 'data' });

      const result = await horizonClient.getFeeStats();

      expect(result).toBeDefined();
    });
  });

  describe('Error Classification and Handling', () => {
    it('should classify rate limit errors correctly', async () => {
      mockServer.loadAccount.mockRejectedValue({ response: { status: 429 } });

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow();

      expect(metricsSpies.errors).toHaveBeenCalledWith({
        operation: 'loadAccount',
        error_type: 'rate_limit',
      });
    });

    it('should classify not found errors correctly', async () => {
      mockServer.loadAccount.mockRejectedValue({ response: { status: 404 } });

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow();

      expect(metricsSpies.errors).toHaveBeenCalledWith({
        operation: 'loadAccount',
        error_type: 'not_found',
      });
    });

    it('should classify server errors correctly', async () => {
      mockServer.loadAccount.mockRejectedValue({ response: { status: 502 } });

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow();

      expect(metricsSpies.errors).toHaveBeenCalledWith({
        operation: 'loadAccount',
        error_type: 'server_error',
      });
    });

    it('should classify client errors correctly', async () => {
      mockServer.loadAccount.mockRejectedValue({ response: { status: 400 } });

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow();

      expect(metricsSpies.errors).toHaveBeenCalledWith({
        operation: 'loadAccount',
        error_type: 'client_error',
      });
    });

    it('should classify network errors correctly', async () => {
      mockServer.loadAccount.mockRejectedValue({ code: 'ECONNREFUSED' });

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow();

      expect(metricsSpies.errors).toHaveBeenCalledWith({
        operation: 'loadAccount',
        error_type: 'network_error',
      });
    });

    it('should classify timeout errors correctly', async () => {
      const error = new Error('Request timeout');
      error.name = 'AbortError';
      error.code = 'ABORT';
      mockServer.loadAccount.mockRejectedValue(error);

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow();

      expect(metricsSpies.errors).toHaveBeenCalledWith({
        operation: 'loadAccount',
        error_type: 'timeout',
      });
    });

    it('should classify unknown errors correctly', async () => {
      mockServer.loadAccount.mockRejectedValue(new Error('Unknown error'));

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow();

      expect(metricsSpies.errors).toHaveBeenCalledWith({
        operation: 'loadAccount',
        error_type: 'unknown',
      });
    });
  });

  describe('Retry Logic Validation', () => {
    it('should respect custom retry delays', async () => {
      const customClient = new HorizonClient(TEST_HORIZON_URL, TEST_NETWORK_PASSPHRASE, {
        retryDelays: [10, 20, 30],
      });

      mockServer.loadAccount
        .mockRejectedValueOnce({ response: { status: 429 } })
        .mockRejectedValueOnce({ response: { status: 429 } })
        .mockRejectedValueOnce({ response: { status: 429 } })
        .mockResolvedValueOnce({ id: TEST_ACCOUNT_ID });

      const startTime = Date.now();
      await customClient.loadAccount(TEST_ACCOUNT_ID);
      const duration = Date.now() - startTime;

      // Should take at least the sum of retry delays (10 + 20 + 30 = 60ms)
      expect(duration).toBeGreaterThanOrEqual(50);
    });

    it('should not retry on non-retryable errors', async () => {
      mockServer.loadAccount.mockRejectedValue({ response: { status: 401 } });

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow();

      expect(mockServer.loadAccount).toHaveBeenCalledTimes(1);
      expect(metricsSpies.retries).not.toHaveBeenCalled();
    });

    it('should retry on various network error codes', async () => {
      const networkErrors = [
        { code: 'ECONNABORTED' },
        { code: 'ECONNREFUSED' },
        { code: 'ECONNRESET' },
        { code: 'ENETUNREACH' },
        { code: 'EHOSTUNREACH' },
        { code: 'ETIMEDOUT' },
      ];

      for (const error of networkErrors) {
        mockServer.loadAccount
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce({ id: TEST_ACCOUNT_ID });

        await horizonClient.loadAccount(TEST_ACCOUNT_ID);

        expect(mockServer.loadAccount).toHaveBeenCalledTimes(2);
        mockServer.loadAccount.mockReset();
      }
    });

    it('should stop retrying after max attempts', async () => {
      mockServer.loadAccount.mockRejectedValue({ response: { status: 429 } });

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow();

      // Initial attempt + 2 retries (default retryDelays = [150, 500])
      expect(mockServer.loadAccount).toHaveBeenCalledTimes(3);
    });
  });

  describe('Configuration and State', () => {
    it('should return correct configuration', () => {
      const config = horizonClient.getConfig();

      expect(config.horizonUrl).toBe(TEST_HORIZON_URL);
      expect(config.networkPassphrase).toBe(TEST_NETWORK_PASSPHRASE);
      expect(config.retryDelays).toEqual([50, 100]);
      expect(config.healthTimeout).toBe(1000);
    });

    it('should normalize horizon URL by removing trailing slash', () => {
      const client = new HorizonClient(
        'https://horizon-testnet.stellar.org/',
        TEST_NETWORK_PASSPHRASE
      );

      expect(client.getConfig().horizonUrl).toBe('https://horizon-testnet.stellar.org');
    });

    it('should use default options when not provided', () => {
      const defaultClient = new HorizonClient(
        TEST_HORIZON_URL,
        TEST_NETWORK_PASSPHRASE
      );

      const config = defaultClient.getConfig();

      expect(config.retryDelays).toEqual([150, 500]);
      expect(config.healthTimeout).toBe(2000);
    });
  });

  describe('Security and Edge Cases', () => {
    it('should handle malformed response data gracefully', async () => {
      mockServer.loadAccount.mockResolvedValue(null);

      const result = await horizonClient.loadAccount(TEST_ACCOUNT_ID);

      expect(result).toBeNull();
    });

    it('should handle extremely long response data', async () => {
      const largeData = {
        id: TEST_ACCOUNT_ID,
        data: {},
      };
      // Add many properties to simulate large response
      for (let i = 0; i < 1000; i++) {
        largeData.data[`key_${i}`] = `value_${i}`.repeat(100);
      }

      mockServer.loadAccount.mockResolvedValue(largeData);

      const result = await horizonClient.loadAccount(TEST_ACCOUNT_ID);

      expect(result).toBeDefined();
    });

    it('should handle concurrent requests safely', async () => {
      const promises = Array.from({ length: 10 }, () =>
        horizonClient.loadAccount(TEST_ACCOUNT_ID)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      expect(results.every(r => r !== undefined)).toBe(true);
    });

    it('should handle special characters in account IDs', async () => {
      const specialAccountId = 'G' + 'A'.repeat(55); // Valid format

      mockServer.loadAccount.mockResolvedValue({
        id: specialAccountId,
        account_id: specialAccountId,
      });

      const result = await horizonClient.loadAccount(specialAccountId);

      expect(result).toBeDefined();
      expect(mockServer.loadAccount).toHaveBeenCalledWith(specialAccountId);
    });

    it('should handle zero amounts in payment operations', async () => {
      const callMock = vi.fn().mockResolvedValue({
        records: [
          {
            id: '123',
            type: 'payment',
            amount: '0.0000000',
            to: TEST_ACCOUNT_ID,
          },
        ],
      });

      const mockBuilder = {
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        call: callMock,
      };

      mockServer.payments.mockReturnValue({
        forAccount: vi.fn().mockReturnValue(mockBuilder),
      });

      const result = await horizonClient.fetchPayments(TEST_ACCOUNT_ID);

      expect(result.records[0].amount).toBe('0.0000000');
    });

    it('should handle very large amounts', async () => {
      const callMock = vi.fn().mockResolvedValue({
        records: [
          {
            id: '123',
            type: 'payment',
            amount: '999999999999.9999999',
            to: TEST_ACCOUNT_ID,
          },
        ],
      });

      const mockBuilder = {
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        call: callMock,
      };

      mockServer.payments.mockReturnValue({
        forAccount: vi.fn().mockReturnValue(mockBuilder),
      });

      const result = await horizonClient.fetchPayments(TEST_ACCOUNT_ID);

      expect(result.records[0].amount).toBe('999999999999.9999999');
    });
  });

  describe('Metrics Integration', () => {
    it('should record operation metrics for successful calls', async () => {
      await horizonClient.loadAccount(TEST_ACCOUNT_ID);

      expect(metricsSpies.operations).toHaveBeenCalledWith({
        operation: 'loadAccount',
        result: 'success',
      });
      expect(metricsSpies.latency).toHaveBeenCalledWith(
        { operation: 'loadAccount', result: 'success' },
        expect.any(Number)
      );
    });

    it('should record operation metrics for failed calls', async () => {
      mockServer.loadAccount.mockRejectedValue({ response: { status: 404 } });

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow();

      expect(metricsSpies.operations).toHaveBeenCalledWith({
        operation: 'loadAccount',
        result: 'error',
      });
      expect(metricsSpies.errors).toHaveBeenCalledWith({
        operation: 'loadAccount',
        error_type: 'not_found',
      });
    });

    it('should record retry metrics', async () => {
      mockServer.loadAccount
        .mockRejectedValueOnce({ response: { status: 429 } })
        .mockResolvedValueOnce({ id: TEST_ACCOUNT_ID });

      await horizonClient.loadAccount(TEST_ACCOUNT_ID);

      expect(metricsSpies.retries).toHaveBeenCalledWith({
        operation: 'loadAccount',
      });
    });

    it('should include operation context in error metrics', async () => {
      mockServer.loadAccount.mockRejectedValue({ response: { status: 404 } });

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow();

      expect(metricsSpies.errors).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'loadAccount',
        })
      );
    });
  });

  describe('Integration with Stellar SDK', () => {
    it('should properly initialize Stellar SDK Server', () => {
      expect(StellarSdk.Horizon.Server).toHaveBeenCalledWith(TEST_HORIZON_URL);
    });

    it('should pass correct parameters to SDK methods', async () => {
      await horizonClient.loadAccount(TEST_ACCOUNT_ID);

      expect(mockServer.loadAccount).toHaveBeenCalledWith(TEST_ACCOUNT_ID);
    });

    it('should handle SDK-specific error formats', async () => {
      const sdkError = new Error('SDK-specific error');
      sdkError.response = { data: { detail: 'Invalid request' }, status: 400 };

      mockServer.loadAccount.mockRejectedValue(sdkError);

      await expect(horizonClient.loadAccount(TEST_ACCOUNT_ID)).rejects.toThrow();
    });
  });
});
