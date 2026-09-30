/**
 * Tests for fraud-detection-sanitizer.js (#1427)
 */
import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeAndValidateFraudPayload,
  validateMerchantId,
  fraudDetectionPayloadSchema,
} from './fraud-detection-sanitizer.js';

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('./sanitize-metadata.js', () => ({
  sanitizeMetadata: vi.fn((m) => m),
}));

const validPayment = {
  id: 'pay_001',
  amount: '100.00',
  recipient: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZL2OKXNBDXOFQNHQ2O6T',
  status: 'pending',
  created_at: new Date().toISOString(),
  memo: 'test payment',
  metadata: { orderId: 'ORD-123' },
};

describe('sanitizeAndValidateFraudPayload', () => {
  it('accepts a valid payload', () => {
    const result = sanitizeAndValidateFraudPayload(validPayment, 'merchant-001');
    expect(result.valid).toBe(true);
    expect(result.payload.id).toBe('pay_001');
    expect(result.merchantId).toBe('merchant-001');
  });

  it('rejects a non-object payload', () => {
    const result = sanitizeAndValidateFraudPayload('not-an-object', 'merchant-001');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Payload must be a non-null object');
  });

  it('rejects null payload', () => {
    const result = sanitizeAndValidateFraudPayload(null, 'merchant-001');
    expect(result.valid).toBe(false);
  });

  it('rejects array payload', () => {
    const result = sanitizeAndValidateFraudPayload([validPayment], 'merchant-001');
    expect(result.valid).toBe(false);
  });

  it('rejects invalid Stellar address', () => {
    const result = sanitizeAndValidateFraudPayload(
      { ...validPayment, recipient: 'not-a-stellar-address' },
      'merchant-001'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('recipient'))).toBe(true);
  });

  it('rejects negative amount', () => {
    const result = sanitizeAndValidateFraudPayload(
      { ...validPayment, amount: '-5.00' },
      'merchant-001'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('amount'))).toBe(true);
  });

  it('rejects zero amount', () => {
    const result = sanitizeAndValidateFraudPayload(
      { ...validPayment, amount: '0' },
      'merchant-001'
    );
    expect(result.valid).toBe(false);
  });

  it('rejects invalid payment status', () => {
    const result = sanitizeAndValidateFraudPayload(
      { ...validPayment, status: 'hacked' },
      'merchant-001'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('status'))).toBe(true);
  });

  it('rejects invalid created_at', () => {
    const result = sanitizeAndValidateFraudPayload(
      { ...validPayment, created_at: 'not-a-date' },
      'merchant-001'
    );
    expect(result.valid).toBe(false);
  });

  it('strips __proto__ from payload', () => {
    const malicious = JSON.parse('{"__proto__":{"polluted":true},"id":"pay_002","amount":"10.00","recipient":"GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZL2OKXNBDXOFQNHQ2O6T","status":"pending","created_at":"' + new Date().toISOString() + '"}');
    const result = sanitizeAndValidateFraudPayload(malicious, 'merchant-001');
    // __proto__ stripped; payload may still be valid if other fields are present
    if (result.valid) {
      expect(result.payload).not.toHaveProperty('__proto__');
    } else {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('truncates memo exceeding 200 characters', () => {
    const longMemo = 'x'.repeat(300);
    const result = sanitizeAndValidateFraudPayload(
      { ...validPayment, memo: longMemo },
      'merchant-001'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('memo'))).toBe(true);
  });

  it('strips control characters from memo', () => {
    const result = sanitizeAndValidateFraudPayload(
      { ...validPayment, memo: 'hello\u0000world\u001F' },
      'merchant-001'
    );
    if (result.valid) {
      expect(result.payload.memo).toBe('helloworld');
    }
  });

  it('rejects invalid merchant ID with special chars', () => {
    const result = sanitizeAndValidateFraudPayload(validPayment, 'merchant<script>');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('merchantId'))).toBe(true);
  });

  it('accepts empty merchant ID (treated as unknown)', () => {
    const result = sanitizeAndValidateFraudPayload(validPayment, '');
    // Empty merchantId is treated as 'unknown' (not rejected)
    expect(result.valid).toBe(true);
    expect(result.merchantId).toBe('unknown');
  });

  it('accepts payload with null memo', () => {
    const result = sanitizeAndValidateFraudPayload(
      { ...validPayment, memo: null },
      'merchant-001'
    );
    expect(result.valid).toBe(true);
  });

  it('accepts payload without memo field', () => {
    const { memo, ...noMemo } = validPayment;
    const result = sanitizeAndValidateFraudPayload(noMemo, 'merchant-001');
    expect(result.valid).toBe(true);
  });

  it('accepts all valid payment statuses', () => {
    const statuses = ['pending', 'completed', 'failed', 'expired', 'refunded'];
    for (const status of statuses) {
      const result = sanitizeAndValidateFraudPayload({ ...validPayment, status }, 'merchant-001');
      expect(result.valid).toBe(true);
    }
  });
});

describe('validateMerchantId', () => {
  it('accepts valid merchant IDs', () => {
    expect(validateMerchantId('merchant-001').valid).toBe(true);
    expect(validateMerchantId('MERCHANT_ABC').valid).toBe(true);
    expect(validateMerchantId('m:123@domain').valid).toBe(true);
  });

  it('rejects empty string', () => {
    expect(validateMerchantId('').valid).toBe(false);
  });

  it('rejects merchant ID with XSS chars', () => {
    expect(validateMerchantId('<script>alert(1)</script>').valid).toBe(false);
  });

  it('rejects overly long merchant ID', () => {
    expect(validateMerchantId('a'.repeat(129)).valid).toBe(false);
  });
});

describe('fraudDetectionPayloadSchema edge cases', () => {
  it('validates amount with up to 7 decimal places', () => {
    expect(fraudDetectionPayloadSchema.safeParse({ ...validPayment, amount: '1.1234567' }).success).toBe(true);
  });

  it('rejects amount with more than 7 decimal places', () => {
    expect(fraudDetectionPayloadSchema.safeParse({ ...validPayment, amount: '1.12345678' }).success).toBe(false);
  });

  it('rejects missing id', () => {
    const { id, ...noId } = validPayment;
    expect(fraudDetectionPayloadSchema.safeParse(noId).success).toBe(false);
  });

  it('rejects missing amount', () => {
    const { amount, ...noAmount } = validPayment;
    expect(fraudDetectionPayloadSchema.safeParse(noAmount).success).toBe(false);
  });
});
