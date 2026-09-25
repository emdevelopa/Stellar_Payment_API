/**
 * Unit Tests for Stellar Horizon Client
 *
 * Comprehensive unit tests for the HorizonClient class covering:
 * - All public methods
 * - Configuration and initialization
 * - Error handling and retry logic through public API
 * - Metrics recording
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HorizonClient } from './horizon-client.js';
import * as StellarSdk from 'stellar-sdk';
import * as metrics from '../metrics.js';

// Mock dependencies
vi.mock('stellar-sdk', () => ({
  Horizon: {
    Server: vi.fn(),
  },
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
  Asset: {
    native: vi.fn(() => ({ isNative: () => true, getCode: () => 'XLM' })),
  },
}));

vi.mock('../logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../metrics.js', () => ({
  horizonClientErrors: { inc: vi.fn() },
  horizonClientOperations: { inc: vi.fn() },
  horizonClientRetries: { inc: vi.fn() },
  horizonClientLatency: { observe: vi.fn() },
  horizonClientHealthCheckDuration: { observe: vi.fn() },
  horizonClientHealthCheckResult: { inc: vi.fn() },
  horizonClientConnections: { inc: vi.fn(), dec: vi.fn() },
  horizonClientConcurrentOperations: { inc: vi.fn(), dec: vi.fn() },
  horizonClientOperationDuration: { observe: vi.fn() },
  horizonClientRetryAttemptDuration: { observe: vi.fn() },
  horizonClientErrorRecovery: { inc: vi.fn() },
}));

describe('HorizonClient Unit Tests', () => {
  let horizonClient;
  let mockServer;
  let metricsSpies;

  const TEST_HORIZON_URL = 'https://horizon-testnet.stellar.org';
  const TEST_NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock server
    mockServer = {
      loadAccount: vi.fn(),
      payments: vi.fn(),
      transactions: vi.fn(),
      feeStats: vi.fn(),
      strictReceivePaths: vi.fn(),
    };

    StellarSdk.Horizon.Server.mockReturnValue(mockServer);

    // Setup metrics spies
    metricsSpies = {
      errors: vi.spyOn(metrics.horizonClientErrors, 'inc'),
      operations: vi.spyOn(metrics.horizonClientOperations, 'inc'),
      retries: vi.spyOn(metrics.horizonClientRetries, 'inc'),
      latency: vi.spyOn(metrics.horizonClientLatency, 'observe'),
    };

    // Create client instance
    horizonClient = new HorizonClient(TEST_HORIZON_URL, TEST_NETWORK_PASSPHRASE, {
      retryDelays: [50, 100],
      healthTimeout: 1000,
    });
  });

  describe('Constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(horizonClient.horizonUrl).toBe(TEST_HORIZON_URL);
      expect(horizonClient.networkPassphrase).toBe(TEST_NETWORK_PASSPHRASE);
      expect(horizonClient.retryDelays).toEqual([50, 100]);
      expect(horizonClient.healthTimeout).toBe(1000);
    });

    it('should normalize URL by removing trailing slash', () => {
      const client = new HorizonClient(
        'https://horizon-testnet.stellar.org/',
        TEST_NETWORK_PASSPHRASE
      );
      expect(client.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    });

    it('should use default options when not provided', () => {
      const client = new HorizonClient(TEST_HORIZON_URL, TEST_NETWORK_PASSPHRASE);
      expect(client.retryDelays).toEqual([150, 500]);
      expect(client.healthTimeout).toBe(2000);
    });

    it('should initialize Stellar SDK Server', () => {
      expect(StellarSdk.Horizon.Server).toHaveBeenCalledWith(TEST_HORIZON_URL);
    });

    it('should increment connection counter', () => {
      expect(metrics.horizonClientConnections.inc).toHaveBeenCalled();
    });
  });

  describe('getConfig', () => {
    it('should return current configuration', () => {
      const config = horizonClient.getConfig();

      expect(config).toEqual({
        horizonUrl: TEST_HORIZON_URL,
        networkPassphrase: TEST_NETWORK_PASSPHRASE,
        retryDelays: [50, 100],
        healthTimeout: 1000,
        retryManager: expect.objectContaining({
          retryDelays: [50, 100],
          maxAttempts: 3,
          currentConcurrentOperations: 0,
        }),
      });
    });
  });

  describe('getRetryManager', () => {
    it('should return the retry manager instance', () => {
      const retryManager = horizonClient.getRetryManager();
      
      expect(retryManager).toBeDefined();
      expect(retryManager.getConfig).toBeDefined();
    });
  });

  describe('getServer', () => {
    it('should return the Stellar SDK server instance', () => {
      const server = horizonClient.getServer();
      
      expect(server).toBeDefined();
      expect(server).toBe(mockServer);
    });
  });

  describe('close', () => {
    it('should decrement connection counter', () => {
      horizonClient.close();
      
      expect(metrics.horizonClientConnections.dec).toHaveBeenCalled();
    });
  });

  describe('isReachable', () => {
    it('should return true when server responds with OK', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await horizonClient.isReachable();

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        TEST_HORIZON_URL,
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' },
        })
      );
    });

    it('should return true when rate limited (429)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
      });

      const result = await horizonClient.isReachable();

      expect(result).toBe(true);
    });

    it('should return false on server error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await horizonClient.isReachable();

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await horizonClient.isReachable();

      expect(result).toBe(false);
      expect(metricsSpies.errors).toHaveBeenCalled();
    });

    it('should timeout after healthTimeout', async () => {
      global.fetch = vi.fn().mockImplementation(
        () => new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AbortError')), 2000)
        )
      );

      const result = await horizonClient.isReachable();

      expect(result).toBe(false);
    });
  });

  describe('loadAccount', () => {
    it('should call server.loadAccount with retry logic', async () => {
      mockServer.loadAccount.mockResolvedValue({ id: 'test-account' });

      await horizonClient.loadAccount('GABC123');

      expect(mockServer.loadAccount).toHaveBeenCalledWith('GABC123');
      expect(metricsSpies.operations).toHaveBeenCalledWith({
        operation: 'loadAccount',
        result: 'success',
      });
    });

    it('should retry on rate limit errors', async () => {
      mockServer.loadAccount
        .mockRejectedValueOnce({ response: { status: 429 } })
        .mockResolvedValueOnce({ id: 'test-account' });

      await horizonClient.loadAccount('GABC123');

      expect(mockServer.loadAccount).toHaveBeenCalledTimes(2);
      expect(metricsSpies.retries).toHaveBeenCalledWith({ operation: 'loadAccount' });
    });

    it('should throw after exhausting retries', async () => {
      mockServer.loadAccount.mockRejectedValue({ response: { status: 429 } });

      await expect(horizonClient.loadAccount('GABC123')).rejects.toThrow('rate limit');
      expect(mockServer.loadAccount).toHaveBeenCalledTimes(3);
    });
  });

  describe('fetchPayments', () => {
    it('should build payment query with options', async () => {
      const mockCall = vi.fn().mockResolvedValue({ records: [] });
      const mockBuilder = {
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        call: mockCall,
      };
      
      mockServer.payments.mockReturnValue({
        forAccount: vi.fn().mockReturnValue(mockBuilder),
      });

      await horizonClient.fetchPayments('GABC123', { order: 'desc', limit: 100 });

      expect(mockCall).toHaveBeenCalled();
      expect(metricsSpies.operations).toHaveBeenCalledWith({
        operation: 'fetchPayments',
        result: 'success',
      });
    });

    it('should handle default options', async () => {
      const mockCall = vi.fn().mockResolvedValue({ records: [] });
      const mockBuilder = {
        call: mockCall,
      };
      
      mockServer.payments.mockReturnValue({
        forAccount: vi.fn().mockReturnValue(mockBuilder),
      });

      await horizonClient.fetchPayments('GABC123');

      expect(mockCall).toHaveBeenCalled();
    });
  });

  describe('fetchTransaction', () => {
    it('should fetch transaction with retry logic', async () => {
      const mockCall = vi.fn().mockResolvedValue({ id: 'tx123' });
      mockServer.transactions.mockReturnValue({
        transaction: vi.fn().mockReturnValue({ call: mockCall }),
      });

      await horizonClient.fetchTransaction('abc123');

      expect(mockServer.transactions().transaction).toHaveBeenCalledWith('abc123');
      expect(metricsSpies.operations).toHaveBeenCalledWith({
        operation: 'fetchTransaction',
        result: 'success',
      });
    });
  });

  describe('findStrictReceivePaths', () => {
    it('should call strictReceivePaths with retry logic', async () => {
      const mockCall = vi.fn().mockResolvedValue({ records: [] });
      mockServer.strictReceivePaths.mockReturnValue({ call: mockCall });

      const sourceAsset = StellarSdk.Asset.native();
      const destAsset = StellarSdk.Asset.native();

      await horizonClient.findStrictReceivePaths([sourceAsset], destAsset, '100');

      expect(mockCall).toHaveBeenCalled();
      expect(metricsSpies.operations).toHaveBeenCalledWith({
        operation: 'findStrictReceivePaths',
        result: 'success',
      });
    });
  });

  describe('getFeeStats', () => {
    it('should fetch fee stats with retry logic', async () => {
      mockServer.feeStats.mockResolvedValue({
        last_ledger_base_fee: '100',
      });

      await horizonClient.getFeeStats();

      expect(mockServer.feeStats).toHaveBeenCalled();
      expect(metricsSpies.operations).toHaveBeenCalledWith({
        operation: 'getFeeStats',
        result: 'success',
      });
    });
  });
});
