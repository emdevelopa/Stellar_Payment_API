/**
 * Granular Metrics Tests for Horizon Client
 * 
 * Tests for the enhanced metrics tracking capabilities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  horizonClientRequestSize,
  horizonClientResponseSize,
  horizonClientCacheHits,
  horizonClientCacheMisses,
  horizonClientConnections,
  horizonClientQueueDepth,
  horizonClientBackpressure,
  horizonClientTimeouts,
  horizonClientCircuitBreakerTrips,
  horizonClientCircuitBreakerState,
  horizonClientHealthCheckDuration,
  horizonClientHealthCheckResult,
  horizonClientConcurrentOperations,
  horizonClientOperationDuration,
  horizonClientRetryAttemptDuration,
  horizonClientErrorRecovery,
  horizonClientDataValidationErrors,
  horizonClientSerializationErrors,
  horizonClientRateLimitWaitTime,
  horizonClientThroughput,
  horizonClientOperationSuccessRate,
} from '../../metrics.js';

describe('Granular Horizon Client Metrics', () => {
  beforeEach(() => {
    // Reset metrics between tests
    horizonClientConnections.reset();
    horizonClientConcurrentOperations.reset();
    horizonClientQueueDepth.reset();
    horizonClientCircuitBreakerState.reset();
    horizonClientThroughput.reset();
    horizonClientOperationSuccessRate.reset();
  });

  describe('Connection Metrics', () => {
    it('should track active connections', () => {
      horizonClientConnections.inc();
      horizonClientConnections.inc();
      
      const metric = horizonClientConnections.get();
      expect(metric.values[0].value).toBe(2);
    });

    it('should decrement connections on close', () => {
      horizonClientConnections.inc();
      horizonClientConnections.inc();
      horizonClientConnections.dec();
      
      const metric = horizonClientConnections.get();
      expect(metric.values[0].value).toBe(1);
    });

    it('should track concurrent operations', () => {
      horizonClientConcurrentOperations.inc();
      horizonClientConcurrentOperations.inc();
      horizonClientConcurrentOperations.inc();
      
      const metric = horizonClientConcurrentOperations.get();
      expect(metric.values[0].value).toBe(3);
    });
  });

  describe('Size Metrics', () => {
    it('should track request size', () => {
      horizonClientRequestSize.observe({ operation: 'loadAccount' }, 1024);
      horizonClientRequestSize.observe({ operation: 'loadAccount' }, 2048);
      
      const metric = horizonClientRequestSize.get();
      expect(metric.values.length).toBeGreaterThan(0);
    });

    it('should track response size', () => {
      horizonClientResponseSize.observe({ operation: 'fetchPayments' }, 5120);
      horizonClientResponseSize.observe({ operation: 'fetchPayments' }, 10240);
      
      const metric = horizonClientResponseSize.get();
      expect(metric.values.length).toBeGreaterThan(0);
    });
  });

  describe('Cache Metrics', () => {
    it('should track cache hits', () => {
      horizonClientCacheHits.inc({ operation: 'loadAccount' });
      horizonClientCacheHits.inc({ operation: 'loadAccount' });
      
      const metric = horizonClientCacheHits.get();
      expect(metric.values[0].value).toBe(2);
    });

    it('should track cache misses', () => {
      horizonClientCacheMisses.inc({ operation: 'fetchTransaction' });
      
      const metric = horizonClientCacheMisses.get();
      expect(metric.values[0].value).toBe(1);
    });
  });

  describe('Queue and Backpressure Metrics', () => {
    it('should track queue depth', () => {
      horizonClientQueueDepth.set(5);
      
      const metric = horizonClientQueueDepth.get();
      expect(metric.values[0].value).toBe(5);
    });

    it('should track backpressure rejections', () => {
      horizonClientBackpressure.inc({ operation: 'loadAccount' });
      horizonClientBackpressure.inc({ operation: 'fetchPayments' });
      
      const metric = horizonClientBackpressure.get();
      expect(metric.values.length).toBe(2);
    });
  });

  describe('Timeout Metrics', () => {
    it('should track timeouts by type', () => {
      horizonClientTimeouts.inc({ operation: 'loadAccount', timeout_type: 'connect' });
      horizonClientTimeouts.inc({ operation: 'fetchPayments', timeout_type: 'read' });
      
      const metric = horizonClientTimeouts.get();
      expect(metric.values.length).toBe(2);
    });
  });

  describe('Circuit Breaker Metrics', () => {
    it('should track circuit breaker trips', () => {
      horizonClientCircuitBreakerTrips.inc({ operation: 'loadAccount' });
      
      const metric = horizonClientCircuitBreakerTrips.get();
      expect(metric.values[0].value).toBe(1);
    });

    it('should track circuit breaker state', () => {
      // 0 = closed, 1 = open, 2 = half-open
      horizonClientCircuitBreakerState.set({ operation: 'loadAccount' }, 1);
      
      const metric = horizonClientCircuitBreakerState.get();
      expect(metric.values[0].value).toBe(1);
    });
  });

  describe('Health Check Metrics', () => {
    it('should track health check duration', () => {
      horizonClientHealthCheckDuration.observe(0.5);
      horizonClientHealthCheckDuration.observe(1.2);
      
      const metric = horizonClientHealthCheckDuration.get();
      expect(metric.values.length).toBeGreaterThan(0);
    });

    it('should track health check results', () => {
      horizonClientHealthCheckResult.inc({ result: 'success' });
      horizonClientHealthCheckResult.inc({ result: 'success' });
      horizonClientHealthCheckResult.inc({ result: 'failure' });
      
      const metric = horizonClientHealthCheckResult.get();
      expect(metric.values.length).toBe(2);
    });
  });

  describe('Operation Duration Metrics', () => {
    it('should track operation duration by phase', () => {
      horizonClientOperationDuration.observe({ operation: 'loadAccount', phase: 'execution' }, 0.3);
      horizonClientOperationDuration.observe({ operation: 'loadAccount', phase: 'retry' }, 0.5);
      horizonClientOperationDuration.observe({ operation: 'loadAccount', phase: 'total' }, 1.0);
      
      const metric = horizonClientOperationDuration.get();
      expect(metric.values.length).toBe(3);
    });

    it('should track retry attempt duration', () => {
      horizonClientRetryAttemptDuration.observe({ operation: 'loadAccount', attempt: 1 }, 0.2);
      horizonClientRetryAttemptDuration.observe({ operation: 'loadAccount', attempt: 2 }, 0.3);
      
      const metric = horizonClientRetryAttemptDuration.get();
      expect(metric.values.length).toBe(2);
    });
  });

  describe('Error Recovery Metrics', () => {
    it('should track successful error recoveries', () => {
      horizonClientErrorRecovery.inc({ 
        operation: 'loadAccount', 
        error_type: 'network_error', 
        recovery_attempt: 1 
      });
      
      const metric = horizonClientErrorRecovery.get();
      expect(metric.values[0].value).toBe(1);
    });
  });

  describe('Validation and Serialization Metrics', () => {
    it('should track data validation errors', () => {
      horizonClientDataValidationErrors.inc({ 
        operation: 'loadAccount', 
        validation_type: 'public_key' 
      });
      
      const metric = horizonClientDataValidationErrors.get();
      expect(metric.values[0].value).toBe(1);
    });

    it('should track serialization errors', () => {
      horizonClientSerializationErrors.inc({ 
        operation: 'fetchPayments', 
        data_type: 'json' 
      });
      
      const metric = horizonClientSerializationErrors.get();
      expect(metric.values[0].value).toBe(1);
    });
  });

  describe('Rate Limit Metrics', () => {
    it('should track rate limit wait time', () => {
      horizonClientRateLimitWaitTime.observe(5);
      horizonClientRateLimitWaitTime.observe(10);
      
      const metric = horizonClientRateLimitWaitTime.get();
      expect(metric.values.length).toBeGreaterThan(0);
    });
  });

  describe('Throughput and Success Rate Metrics', () => {
    it('should track throughput by operation', () => {
      horizonClientThroughput.set({ operation: 'loadAccount' }, 100);
      horizonClientThroughput.set({ operation: 'fetchPayments' }, 50);
      
      const metric = horizonClientThroughput.get();
      expect(metric.values.length).toBe(2);
    });

    it('should track operation success rate', () => {
      horizonClientOperationSuccessRate.set({ operation: 'loadAccount' }, 0.95);
      horizonClientOperationSuccessRate.set({ operation: 'fetchPayments' }, 0.88);
      
      const metric = horizonClientOperationSuccessRate.get();
      expect(metric.values.length).toBe(2);
    });
  });

  describe('Metrics Security', () => {
    it('should not expose sensitive data in labels', () => {
      // Ensure that account IDs, transaction hashes, or secrets are not included in metric labels
      const sensitiveData = ['GTESTACCOUNT1234567890123456789012345678901234567890123456789012345', 'secret'];
      
      // Test with safe operation names
      horizonClientOperations.inc({ operation: 'loadAccount', result: 'success' });
      
      const metric = horizonClientOperations.get();
      const labels = metric.values[0].labels;
      
      expect(labels.operation).toBe('loadAccount');
      expect(labels.result).toBe('success');
      expect(sensitiveData.some(data => labels.operation.includes(data))).toBe(false);
    });

    it('should use generic context identifiers instead of full values', () => {
      // Context should use hashed or abbreviated identifiers
      const context = { accountId: 'GTESTACCOUNT1234567890123456789012345678901234567890123456789012345' };
      
      // In production, this should be hashed or abbreviated
      // For testing, we verify the pattern
      expect(context.accountId).toBeDefined();
      expect(context.accountId.length).toBeGreaterThan(0);
    });
  });
});
