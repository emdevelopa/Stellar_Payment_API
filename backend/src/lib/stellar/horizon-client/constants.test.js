/**
 * Horizon Client Constants Tests
 * 
 * Tests for the centralized configuration constants
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RETRY_DELAYS_MS,
  DEFAULT_HEALTH_TIMEOUT_MS,
  RETRYABLE_ERROR_CODES,
  RETRYABLE_ERROR_STATUS_CODES,
  RETRYABLE_MESSAGE_PATTERNS,
  ERROR_CLASSIFICATION,
  ERROR_STATUS_MAPPING,
  HTTP_STATUS_RANGES,
} from './constants.js';

describe('Horizon Client Constants', () => {
  describe('Default Configuration', () => {
    it('should have valid default retry delays', () => {
      expect(DEFAULT_RETRY_DELAYS_MS).toBeInstanceOf(Array);
      expect(DEFAULT_RETRY_DELAYS_MS.length).toBeGreaterThan(0);
      expect(DEFAULT_RETRY_DELAYS_MS.every(delay => typeof delay === 'number' && delay > 0)).toBe(true);
    });

    it('should have valid default health timeout', () => {
      expect(DEFAULT_HEALTH_TIMEOUT_MS).toBeGreaterThan(0);
      expect(DEFAULT_HEALTH_TIMEOUT_MS).toBe(2_000);
    });
  });

  describe('Retryable Error Codes', () => {
    it('should include common network error codes', () => {
      expect(RETRYABLE_ERROR_CODES).toContain('ECONNABORTED');
      expect(RETRYABLE_ERROR_CODES).toContain('ECONNREFUSED');
      expect(RETRYABLE_ERROR_CODES).toContain('ETIMEDOUT');
    });

    it('should all be uppercase strings', () => {
      expect(RETRYABLE_ERROR_CODES.every(code => code === code.toUpperCase())).toBe(true);
    });
  });

  describe('Retryable Error Status Codes', () => {
    it('should include rate limit status code', () => {
      expect(RETRYABLE_ERROR_STATUS_CODES).toContain(429);
    });

    it('should include timeout status code', () => {
      expect(RETRYABLE_ERROR_STATUS_CODES).toContain(408);
    });

    it('should all be numbers', () => {
      expect(RETRYABLE_ERROR_STATUS_CODES.every(code => typeof code === 'number')).toBe(true);
    });
  });

  describe('Retryable Message Patterns', () => {
    it('should include common retryable patterns', () => {
      expect(RETRYABLE_MESSAGE_PATTERNS).toContain('timeout');
      expect(RETRYABLE_MESSAGE_PATTERNS).toContain('network');
      expect(RETRYABLE_MESSAGE_PATTERNS).toContain('socket');
    });

    it('should all be strings', () => {
      expect(RETRYABLE_MESSAGE_PATTERNS.every(pattern => typeof pattern === 'string')).toBe(true);
    });
  });

  describe('Error Classification', () => {
    it('should have all error types defined', () => {
      expect(ERROR_CLASSIFICATION.RATE_LIMIT).toBe('rate_limit');
      expect(ERROR_CLASSIFICATION.NOT_FOUND).toBe('not_found');
      expect(ERROR_CLASSIFICATION.SERVER_ERROR).toBe('server_error');
      expect(ERROR_CLASSIFICATION.CLIENT_ERROR).toBe('client_error');
      expect(ERROR_CLASSIFICATION.NETWORK_ERROR).toBe('network_error');
      expect(ERROR_CLASSIFICATION.TIMEOUT).toBe('timeout');
      expect(ERROR_CLASSIFICATION.UNKNOWN).toBe('unknown');
    });

    it('should have unique error type values', () => {
      const values = Object.values(ERROR_CLASSIFICATION);
      const uniqueValues = new Set(values);
      expect(values.length).toBe(uniqueValues.size);
    });
  });

  describe('Error Status Mapping', () => {
    it('should map error types to status codes', () => {
      expect(ERROR_STATUS_MAPPING[ERROR_CLASSIFICATION.RATE_LIMIT]).toBe(429);
      expect(ERROR_STATUS_MAPPING[ERROR_CLASSIFICATION.NOT_FOUND]).toBe(404);
      expect(ERROR_STATUS_MAPPING[ERROR_CLASSIFICATION.SERVER_ERROR]).toBe(502);
    });

    it('should have valid HTTP status codes', () => {
      const statusCodes = Object.values(ERROR_STATUS_MAPPING);
      expect(statusCodes.every(code => code >= 400 && code < 600)).toBe(true);
    });
  });

  describe('HTTP Status Ranges', () => {
    it('should define standard HTTP status ranges', () => {
      expect(HTTP_STATUS_RANGES.SUCCESS).toEqual([200, 299]);
      expect(HTTP_STATUS_RANGES.REDIRECT).toEqual([300, 399]);
      expect(HTTP_STATUS_RANGES.CLIENT_ERROR).toEqual([400, 499]);
      expect(HTTP_STATUS_RANGES.SERVER_ERROR).toEqual([500, 599]);
    });

    it('should have valid range pairs', () => {
      Object.values(HTTP_STATUS_RANGES).forEach(([min, max]) => {
        expect(min).toBeLessThan(max);
        expect(min).toBeGreaterThanOrEqual(100);
        expect(max).toBeLessThanOrEqual(599);
      });
    });
  });

  describe('Constants Immutability', () => {
    it('should not allow modification of frozen arrays', () => {
      const originalLength = RETRYABLE_ERROR_CODES.length;
      expect(() => {
        RETRYABLE_ERROR_CODES.push('NEW_CODE');
      }).toThrow(); // Arrays are frozen
      
      // Verify it wasn't modified
      expect(RETRYABLE_ERROR_CODES.length).toBe(originalLength);
    });

    it('should not allow modification of frozen objects', () => {
      expect(() => {
        ERROR_CLASSIFICATION.NEW_TYPE = 'new_type';
      }).toThrow(); // Objects are frozen
      
      expect(ERROR_CLASSIFICATION.NEW_TYPE).toBeUndefined();
    });
  });
});
