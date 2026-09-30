# Batch-86: Webhook Event Dispatcher Enhancements

Comprehensive documentation for backend system optimization features addressing issues #1422, #1423, #1424, and #1425.

---

## Issue #1422: Implement Payload Sanitization and Strict Validation for Webhook Event Dispatcher

### Payload Validation Schema

```typescript
// backend/src/lib/webhook-payload-validator.ts
import { z } from 'zod';

// Strict validation schemas for different event types
const BaseEventSchema = z.object({
  id: z.string().uuid('Event ID must be a valid UUID'),
  type: z.enum([
    'payment.created',
    'payment.completed',
    'payment.failed',
    'refund.initiated',
    'refund.completed',
    'settlement.processed',
    'merchant.activated',
    'merchant.suspended'
  ]),
  timestamp: z.number().int().min(0, 'Timestamp must be a valid Unix timestamp'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semantic versioning'),
  metadata: z.record(z.string().max(100), z.unknown()).optional()
});

const PaymentCreatedSchema = BaseEventSchema.extend({
  type: z.literal('payment.created'),
  data: z.object({
    payment_id: z.string().uuid(),
    merchant_id: z.string().uuid(),
    amount: z.number().positive().max(999_999_999, 'Amount exceeds maximum'),
    currency: z.enum(['USD', 'EUR', 'GBP', 'XLM']),
    description: z.string().max(500).optional(),
    customer_email: z.string().email().optional(),
    reference: z.string().max(100).optional(),
    status: z.enum(['pending', 'processing', 'completed', 'failed'])
  })
});

const PaymentCompletedSchema = BaseEventSchema.extend({
  type: z.literal('payment.completed'),
  data: z.object({
    payment_id: z.string().uuid(),
    merchant_id: z.string().uuid(),
    amount: z.number().positive(),
    currency: z.enum(['USD', 'EUR', 'GBP', 'XLM']),
    completed_at: z.number().int(),
    transaction_hash: z.string().optional(),
    confirmation_count: z.number().int().min(0).optional()
  })
});

const RefundInitiatedSchema = BaseEventSchema.extend({
  type: z.literal('refund.initiated'),
  data: z.object({
    refund_id: z.string().uuid(),
    payment_id: z.string().uuid(),
    amount: z.number().positive(),
    reason: z.enum(['customer_request', 'payment_failed', 'duplicate', 'fraud', 'other']),
    initiated_at: z.number().int()
  })
});

// Schema discriminator for routing to correct validator
const WebhookEventSchema = z.discriminatedUnion('type', [
  PaymentCreatedSchema,
  PaymentCompletedSchema,
  RefundInitiatedSchema
  // Add other event schemas as needed
]);

export class WebhookPayloadValidator {
  /**
   * Validates webhook payload against strict schema
   */
  static validate(payload: unknown): { valid: boolean; data?: any; errors?: string[] } {
    try {
      const result = WebhookEventSchema.parse(payload);
      return { valid: true, data: result };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
        return { valid: false, errors };
      }
      return { valid: false, errors: ['Unknown validation error'] };
    }
  }

  /**
   * Sanitizes string fields to prevent injection attacks
   */
  static sanitizePayload(payload: any): any {
    if (typeof payload !== 'object' || payload === null) {
      return payload;
    }

    if (Array.isArray(payload)) {
      return payload.map(item => this.sanitizePayload(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(payload)) {
      // Sanitize key names
      if (typeof key === 'string' && this.isValidFieldName(key)) {
        if (typeof value === 'string') {
          sanitized[key] = this.sanitizeString(value);
        } else if (typeof value === 'object') {
          sanitized[key] = this.sanitizePayload(value);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          sanitized[key] = value;
        }
        // Skip functions, symbols, undefined, null (except explicitly allowed)
      }
    }
    return sanitized;
  }

  /**
   * Validates field names to prevent prototype pollution
   */
  private static isValidFieldName(name: string): boolean {
    const blocked = ['__proto__', 'constructor', 'prototype'];
    if (blocked.includes(name.toLowerCase())) {
      return false;
    }
    // Allow alphanumeric, underscore, hyphen
    return /^[a-zA-Z0-9_-]+$/.test(name);
  }

  /**
   * Sanitizes string values
   */
  private static sanitizeString(value: string): string {
    // Remove null bytes
    let sanitized = value.replace(/\0/g, '');

    // Limit length to prevent DOS
    if (sanitized.length > 10_000) {
      sanitized = sanitized.substring(0, 10_000);
    }

    // Remove potentially dangerous characters for HTML context
    sanitized = sanitized.replace(/[<>\"']/g, (char) => {
      const escapeMap: Record<string, string> = {
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;'
      };
      return escapeMap[char] || char;
    });

    return sanitized;
  }

  /**
   * Validates payload size to prevent DOS
   */
  static validateSize(payload: any, maxSizeBytes: number = 1_000_000): boolean {
    const payloadString = JSON.stringify(payload);
    const sizeInBytes = Buffer.byteLength(payloadString, 'utf-8');
    return sizeInBytes <= maxSizeBytes;
  }
}

export default WebhookPayloadValidator;
```

### Webhook Dispatcher Integration

```typescript
// backend/src/lib/webhook-event-dispatcher.ts
import WebhookPayloadValidator from './webhook-payload-validator.js';

export async function dispatchWebhookEvent(event: any, webhookUrl: string) {
  try {
    // Step 1: Validate payload structure
    const validationResult = WebhookPayloadValidator.validate(event);
    if (!validationResult.valid) {
      console.error('Payload validation failed:', validationResult.errors);
      return { 
        success: false, 
        error: 'Invalid payload format',
        details: validationResult.errors 
      };
    }

    // Step 2: Sanitize payload
    const sanitizedEvent = WebhookPayloadValidator.sanitizePayload(validationResult.data);

    // Step 3: Validate size
    if (!WebhookPayloadValidator.validateSize(sanitizedEvent)) {
      console.error('Payload exceeds maximum size');
      return { 
        success: false, 
        error: 'Payload size exceeds limit' 
      };
    }

    // Step 4: Generate signature with sanitized payload
    const signature = generateWebhookSignature(sanitizedEvent);

    // Step 5: Send webhook with strict headers
    const response = await sendWebhookWithRetry(webhookUrl, sanitizedEvent, signature);

    return response;
  } catch (error) {
    console.error('Webhook dispatch failed:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}
```

### Test Coverage

```typescript
// backend/tests/unit/webhook-payload-validator.test.ts
import { describe, it, expect } from '@jest/globals';
import WebhookPayloadValidator from '../../src/lib/webhook-payload-validator';

describe('WebhookPayloadValidator', () => {
  describe('validate', () => {
    it('should accept valid payment.created event', () => {
      const payload = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'payment.created',
        timestamp: Math.floor(Date.now() / 1000),
        version: '1.0.0',
        data: {
          payment_id: '550e8400-e29b-41d4-a716-446655440001',
          merchant_id: '550e8400-e29b-41d4-a716-446655440002',
          amount: 99.99,
          currency: 'USD',
          status: 'pending'
        }
      };

      const result = WebhookPayloadValidator.validate(payload);
      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should reject invalid currency', () => {
      const payload = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'payment.created',
        timestamp: Math.floor(Date.now() / 1000),
        version: '1.0.0',
        data: {
          payment_id: '550e8400-e29b-41d4-a716-446655440001',
          merchant_id: '550e8400-e29b-41d4-a716-446655440002',
          amount: 99.99,
          currency: 'INVALID'
        }
      };

      const result = WebhookPayloadValidator.validate(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should reject negative amount', () => {
      const payload = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'payment.created',
        timestamp: Math.floor(Date.now() / 1000),
        version: '1.0.0',
        data: {
          payment_id: '550e8400-e29b-41d4-a716-446655440001',
          merchant_id: '550e8400-e29b-41d4-a716-446655440002',
          amount: -99.99,
          currency: 'USD'
        }
      };

      const result = WebhookPayloadValidator.validate(payload);
      expect(result.valid).toBe(false);
    });
  });

  describe('sanitizePayload', () => {
    it('should remove null bytes from strings', () => {
      const payload = { description: 'test\x00value' };
      const sanitized = WebhookPayloadValidator.sanitizePayload(payload);
      expect(sanitized.description).toBe('testvalue');
    });

    it('should escape HTML special characters', () => {
      const payload = { description: '<script>alert("xss")</script>' };
      const sanitized = WebhookPayloadValidator.sanitizePayload(payload);
      expect(sanitized.description).not.toContain('<script>');
      expect(sanitized.description).toContain('&lt;');
    });

    it('should reject prototype pollution attempts', () => {
      const payload = { '__proto__': { admin: true } };
      const sanitized = WebhookPayloadValidator.sanitizePayload(payload);
      expect(sanitized.__proto__).toBeUndefined();
    });

    it('should truncate excessively long strings', () => {
      const longString = 'a'.repeat(20_000);
      const payload = { description: longString };
      const sanitized = WebhookPayloadValidator.sanitizePayload(payload);
      expect(sanitized.description.length).toBeLessThanOrEqual(10_000);
    });
  });

  describe('validateSize', () => {
    it('should accept payload under size limit', () => {
      const payload = { small: 'data' };
      const isValid = WebhookPayloadValidator.validateSize(payload, 1_000_000);
      expect(isValid).toBe(true);
    });

    it('should reject payload exceeding size limit', () => {
      const largeString = 'x'.repeat(2_000_000);
      const payload = { large: largeString };
      const isValid = WebhookPayloadValidator.validateSize(payload, 1_000_000);
      expect(isValid).toBe(false);
    });
  });
});
```

---

## Issue #1423: Add Prometheus Alert Metrics and Health Telemetry to Webhook Event Dispatcher

### Prometheus Metrics Setup

```typescript
// backend/src/lib/webhook-metrics.ts
import { register, Counter, Histogram, Gauge } from 'prom-client';

// Webhook dispatch metrics
export const webhookDispatchAttempts = new Counter({
  name: 'webhook_dispatch_attempts_total',
  help: 'Total number of webhook dispatch attempts',
  labelNames: ['event_type', 'status']
});

export const webhookDispatchDuration = new Histogram({
  name: 'webhook_dispatch_duration_seconds',
  help: 'Webhook dispatch duration in seconds',
  labelNames: ['event_type'],
  buckets: [0.1, 0.5, 1.0, 2.0, 5.0, 10.0]
});

export const webhookDispatchErrors = new Counter({
  name: 'webhook_dispatch_errors_total',
  help: 'Total webhook dispatch errors',
  labelNames: ['event_type', 'error_type']
});

export const webhookRetryAttempts = new Counter({
  name: 'webhook_retry_attempts_total',
  help: 'Total webhook retry attempts',
  labelNames: ['event_type', 'retry_count']
});

// Queue metrics
export const webhookQueueSize = new Gauge({
  name: 'webhook_queue_size',
  help: 'Current size of webhook dispatch queue'
});

export const webhookQueueDelay = new Histogram({
  name: 'webhook_queue_delay_seconds',
  help: 'Delay between webhook creation and dispatch',
  buckets: [0.1, 1.0, 5.0, 10.0, 30.0, 60.0, 300.0]
});

// Health metrics
export const webhookHealthStatus = new Gauge({
  name: 'webhook_health_status',
  help: 'Webhook dispatcher health status (1=healthy, 0=unhealthy)',
  labelNames: ['component']
});

export const webhookFailureRate = new Gauge({
  name: 'webhook_failure_rate',
  help: 'Current webhook failure rate (0-1)',
  labelNames: ['time_window']
});

export const webhookUptime = new Gauge({
  name: 'webhook_uptime_seconds',
  help: 'Webhook dispatcher uptime in seconds'
});

// Alert thresholds
export const ALERT_THRESHOLDS = {
  ERROR_RATE: 0.05, // 5% error rate
  QUEUE_SIZE: 10_000,
  DISPATCH_LATENCY: 5000, // 5 seconds
  RETRY_EXHAUSTION: 0.1 // 10% of events exhausted retries
};

// Health check function
export async function checkWebhookHealth(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  details: Record<string, any>;
}> {
  const details: any = {
    timestamp: new Date().toISOString(),
    components: {}
  };

  try {
    // Check queue health
    const queueSize = webhookQueueSize.get().values[0]?.value || 0;
    details.components.queue = {
      size: queueSize,
      healthy: queueSize < ALERT_THRESHOLDS.QUEUE_SIZE
    };

    // Check error rate
    const errorRateMetric = webhookFailureRate.get().values.find(
      v => v.labels.time_window === '5m'
    );
    const errorRate = errorRateMetric?.value || 0;
    details.components.errorRate = {
      rate: errorRate,
      healthy: errorRate < ALERT_THRESHOLDS.ERROR_RATE
    };

    // Check dispatch latency
    const latencyMetric = webhookDispatchDuration.get().values.find(
      v => v.labels.quantile === '0.95'
    );
    const p95Latency = (latencyMetric?.value || 0) * 1000;
    details.components.latency = {
      p95_ms: p95Latency,
      healthy: p95Latency < ALERT_THRESHOLDS.DISPATCH_LATENCY
    };

    // Determine overall health
    const allHealthy = Object.values(details.components).every(
      (c: any) => c.healthy !== false
    );

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      details
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
}

export function getMetricsRegistry() {
  return register;
}
```

### Health Monitoring Endpoint

```typescript
// backend/src/routes/webhook-health.ts
import express from 'express';
import { checkWebhookHealth, getMetricsRegistry } from '../lib/webhook-metrics.js';

const router = express.Router();

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const health = await checkWebhookHealth();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Health check failed'
    });
  }
});

// Prometheus metrics endpoint
router.get('/metrics', async (req, res) => {
  try {
    const metrics = await getMetricsRegistry().metrics();
    res.set('Content-Type', getMetricsRegistry().contentType);
    res.send(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
});

export default router;
```

---

## Issue #1424: Implement Automated Retry with Exponential Backoff in Webhook Event Dispatcher

### Retry Strategy Implementation

```typescript
// backend/src/lib/webhook-retry-strategy.ts
import { webhookRetryAttempts } from './webhook-metrics.js';

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number; // 0.0 to 1.0
  retryableStatusCodes: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504]
};

export class WebhookRetryStrategy {
  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  static calculateDelay(attemptNumber: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
    // Calculate base delay: initialDelay * (multiplier ^ attemptNumber)
    const baseDelay = Math.min(
      config.initialDelayMs * Math.pow(config.backoffMultiplier, attemptNumber),
      config.maxDelayMs
    );

    // Add jitter to prevent thundering herd
    const jitter = baseDelay * config.jitterFactor * Math.random();
    const delay = baseDelay + jitter;

    return Math.floor(delay);
  }

  /**
   * Determine if request should be retried based on status code
   */
  static isRetryable(
    statusCode: number | undefined,
    error: Error | undefined,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
  ): boolean {
    // Network errors are always retryable
    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes('timeout') || 
          message.includes('econnrefused') ||
          message.includes('econnreset') ||
          message.includes('socket hang up')) {
        return true;
      }
    }

    // Check status code
    if (statusCode && config.retryableStatusCodes.includes(statusCode)) {
      return true;
    }

    return false;
  }

  /**
   * Execute webhook with automatic retry logic
   */
  static async executeWithRetry(
    fn: () => Promise<{ statusCode: number }>,
    eventType: string,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<{ success: boolean; statusCode?: number; error?: string; attempts: number }> {
    let lastError: Error | undefined;
    let lastStatusCode: number | undefined;

    for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
      try {
        const result = await fn();
        lastStatusCode = result.statusCode;

        // Success on 2xx status codes
        if (result.statusCode >= 200 && result.statusCode < 300) {
          webhookRetryAttempts.inc({ event_type: eventType, retry_count: String(attempt) });
          return { 
            success: true, 
            statusCode: result.statusCode,
            attempts: attempt + 1 
          };
        }

        // Check if retryable
        if (!this.isRetryable(result.statusCode, undefined, config)) {
          return { 
            success: false, 
            statusCode: result.statusCode,
            error: `HTTP ${result.statusCode}`,
            attempts: attempt + 1 
          };
        }

        // Schedule retry
        if (attempt < config.maxAttempts - 1) {
          const delay = this.calculateDelay(attempt, config);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        lastError = error as Error;
        lastStatusCode = undefined;

        // Check if retryable
        if (!this.isRetryable(undefined, lastError, config)) {
          return { 
            success: false, 
            error: lastError.message,
            attempts: attempt + 1 
          };
        }

        // Schedule retry
        if (attempt < config.maxAttempts - 1) {
          const delay = this.calculateDelay(attempt, config);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted
    webhookRetryAttempts.inc({ 
      event_type: eventType, 
      retry_count: String(config.maxAttempts) 
    });

    return { 
      success: false, 
      statusCode: lastStatusCode,
      error: lastError?.message || 'Max retries exceeded',
      attempts: config.maxAttempts 
    };
  }
}

export default WebhookRetryStrategy;
```

### Database Schema for Retry Tracking

```sql
-- backend/migrations/webhook_retry_tracking.sql
CREATE TABLE webhook_dispatch_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  webhook_url TEXT NOT NULL,
  attempt_number INT NOT NULL,
  status_code INT,
  response_body TEXT,
  error_message TEXT,
  retry_delay_ms INT,
  next_retry_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (event_id) REFERENCES webhook_events(id) ON DELETE CASCADE
);

CREATE INDEX idx_webhook_dispatch_attempts_event_id 
  ON webhook_dispatch_attempts(event_id);
CREATE INDEX idx_webhook_dispatch_attempts_next_retry 
  ON webhook_dispatch_attempts(next_retry_at) 
  WHERE next_retry_at IS NOT NULL;

-- Track retry exhaustion
CREATE TABLE webhook_retry_exhaustion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  webhook_url TEXT NOT NULL,
  final_status_code INT,
  final_error_message TEXT,
  total_attempts INT NOT NULL,
  total_duration_ms INT,
  exhausted_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (event_id) REFERENCES webhook_events(id) ON DELETE CASCADE
);

CREATE INDEX idx_webhook_retry_exhaustion_event_id 
  ON webhook_retry_exhaustion(event_id);
```

---

## Issue #1425: Enhance Distributed Concurrency Control and Locking for Webhook Event Dispatcher

### Distributed Lock Implementation

```typescript
// backend/src/lib/webhook-distributed-lock.ts
import Redis from 'redis';
import { v4 as uuidv4 } from 'uuid';

export interface LockOptions {
  ttlMs: number;
  maxWaitMs: number;
  pollIntervalMs: number;
}

const DEFAULT_LOCK_OPTIONS: LockOptions = {
  ttlMs: 30_000,      // 30 seconds
  maxWaitMs: 60_000,  // Wait max 60 seconds
  pollIntervalMs: 100 // Poll every 100ms
};

export class WebhookDistributedLock {
  private redisClient: Redis.RedisClient;
  private lockId: string;
  private lockKey: string;

  constructor(redisClient: Redis.RedisClient, lockKey: string) {
    this.redisClient = redisClient;
    this.lockKey = `webhook:lock:${lockKey}`;
    this.lockId = uuidv4();
  }

  /**
   * Acquire lock with exponential backoff
   */
  async acquire(options: LockOptions = DEFAULT_LOCK_OPTIONS): Promise<boolean> {
    const startTime = Date.now();
    let backoffMs = 10;

    while (Date.now() - startTime < options.maxWaitMs) {
      try {
        // Try to acquire lock using SET NX (atomic operation)
        const acquired = await this.redisClient.set(
          this.lockKey,
          this.lockId,
          'PX',
          options.ttlMs,
          'NX'
        );

        if (acquired === 'OK') {
          // Successfully acquired lock
          return true;
        }

        // Wait before retry with exponential backoff
        await new Promise(resolve => 
          setTimeout(resolve, Math.min(backoffMs, options.pollIntervalMs))
        );
        backoffMs = Math.min(backoffMs * 1.5, 1000);
      } catch (error) {
        console.error('Lock acquisition error:', error);
        return false;
      }
    }

    return false;
  }

  /**
   * Release lock (only if owned by this instance)
   */
  async release(): Promise<boolean> {
    try {
      // Use Lua script to ensure atomic check-and-delete
      const script = `
        if redis.call('get', KEYS[1]) == ARGV[1] then
          return redis.call('del', KEYS[1])
        else
          return 0
        end
      `;

      const result = await this.redisClient.eval(
        script,
        1,
        this.lockKey,
        this.lockId
      );

      return result === 1;
    } catch (error) {
      console.error('Lock release error:', error);
      return false;
    }
  }

  /**
   * Extend lock TTL
   */
  async extend(ttlMs: number = DEFAULT_LOCK_OPTIONS.ttlMs): Promise<boolean> {
    try {
      const script = `
        if redis.call('get', KEYS[1]) == ARGV[1] then
          return redis.call('pexpire', KEYS[1], ARGV[2])
        else
          return 0
        end
      `;

      const result = await this.redisClient.eval(
        script,
        1,
        this.lockKey,
        this.lockId,
        String(ttlMs)
      );

      return result === 1;
    } catch (error) {
      console.error('Lock extend error:', error);
      return false;
    }
  }
}

/**
 * Execute function with distributed lock
 */
export async function withDistributedLock<T>(
  redisClient: Redis.RedisClient,
  lockKey: string,
  fn: () => Promise<T>,
  options: LockOptions = DEFAULT_LOCK_OPTIONS
): Promise<T | undefined> {
  const lock = new WebhookDistributedLock(redisClient, lockKey);

  if (!await lock.acquire(options)) {
    throw new Error(`Failed to acquire lock for ${lockKey}`);
  }

  try {
    // Periodically extend lock while executing
    const extendInterval = setInterval(
      () => lock.extend(options.ttlMs),
      options.ttlMs / 2
    );

    try {
      return await fn();
    } finally {
      clearInterval(extendInterval);
    }
  } finally {
    await lock.release();
  }
}
```

### Concurrent Event Processing

```typescript
// backend/src/lib/webhook-event-dispatcher-concurrent.ts
import { withDistributedLock } from './webhook-distributed-lock.js';
import WebhookRetryStrategy from './webhook-retry-strategy.js';
import Redis from 'redis';

interface WebhookDispatchTask {
  eventId: string;
  webhookUrl: string;
  payload: any;
  concurrencyKey: string; // Used for locking (e.g., merchant_id)
}

export class ConcurrentWebhookDispatcher {
  private redisClient: Redis.RedisClient;
  private maxConcurrentPerKey = 10;

  constructor(redisClient: Redis.RedisClient) {
    this.redisClient = redisClient;
  }

  /**
   * Dispatch webhook with concurrency control
   */
  async dispatch(task: WebhookDispatchTask): Promise<{
    success: boolean;
    error?: string;
    attempts: number;
  }> {
    // Use concurrency key to prevent overwhelming single endpoint
    const lockKey = `webhook:dispatch:${task.concurrencyKey}`;

    try {
      return await withDistributedLock(
        this.redisClient,
        lockKey,
        async () => {
          // Check concurrent request count
          const activeCount = await this.getActiveDipatchCount(task.concurrencyKey);
          if (activeCount >= this.maxConcurrentPerKey) {
            return {
              success: false,
              error: 'Max concurrent requests exceeded',
              attempts: 0
            };
          }

          // Execute webhook with retry strategy
          return await WebhookRetryStrategy.executeWithRetry(
            () => this.sendWebhook(task),
            task.eventId
          );
        },
        { ttlMs: 30_000, maxWaitMs: 60_000, pollIntervalMs: 100 }
      );
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Dispatch failed',
        attempts: 0
      };
    }
  }

  private async getActiveDipatchCount(concurrencyKey: string): Promise<number> {
    try {
      const count = await this.redisClient.get(`webhook:active:${concurrencyKey}`);
      return count ? parseInt(count) : 0;
    } catch {
      return 0;
    }
  }

  private async sendWebhook(task: WebhookDispatchTask): Promise<{ statusCode: number }> {
    // Implementation of actual webhook send
    const response = await fetch(task.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task.payload),
      timeout: 30_000
    });

    return { statusCode: response.status };
  }
}
```

---

## Testing Requirements

### Test Coverage
- [ ] Payload validation for all event types
- [ ] Sanitization of strings, field names, HTML
- [ ] Size validation and truncation
- [ ] Prometheus metrics collection
- [ ] Health check endpoint
- [ ] Retry delay calculation
- [ ] Retry logic with various status codes
- [ ] Distributed lock acquisition and release
- [ ] Concurrent dispatch limiting
- [ ] Metrics export in Prometheus format

### Integration Tests
- [ ] Full dispatch flow with validation, sanitization, retry
- [ ] Health check with degraded components
- [ ] Lock contention scenarios
- [ ] Concurrent requests to same endpoint
- [ ] Metrics aggregation over time

### E2E Tests
- [ ] Webhook delivery with retries
- [ ] Error recovery scenarios
- [ ] Health degradation on high error rate
- [ ] Lock timeout recovery

---

## Deployment Checklist
- [ ] Install Redis for distributed locking
- [ ] Install prom-client for Prometheus metrics
- [ ] Add Zod for payload validation
- [ ] Create webhook_dispatch_attempts table
- [ ] Create webhook_retry_exhaustion table
- [ ] Configure Redis connection
- [ ] Deploy metrics endpoint (/metrics)
- [ ] Deploy health check endpoint (/health)
- [ ] Set up Prometheus scraping
- [ ] Configure Prometheus alert rules
- [ ] Test retry strategy with various scenarios
- [ ] Monitor queue depth in production
- [ ] Set up alerting thresholds
- [ ] Document metrics and health endpoints
