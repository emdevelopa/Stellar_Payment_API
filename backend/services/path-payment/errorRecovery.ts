import { logger } from '../../src/lib/logger.js';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export enum ErrorCategory {
  TRANSIENT = 'transient',
  PERMANENT = 'permanent',
  RATE_LIMITED = 'rate_limited',
  AUTH = 'auth'
}

interface ErrorRecoveryOptions {
  maxRetries?: number;
  failureThreshold?: number;
  resetTimeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
}

interface RecoveryMetrics {
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  circuitBreakerTrips: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
}

const RETRYABLE_ERROR_CODES = new Set([
  '08000', '08003', '08006', '08P01',
  '40001', '40P01',
  '53300', '57P01', '57P02', '57P03',
]);

const NON_RETRYABLE_REASONS = new Set([
  'invalid_signature', 'malformed_request', 'authorization_failure',
  'invalid_input', 'not_found', 'duplicate',
]);

function classifyError(error: any): ErrorCategory {
  if (!error) return ErrorCategory.TRANSIENT;

  const reason = error.reason || error.message || '';
  if (NON_RETRYABLE_REASONS.has(reason)) return ErrorCategory.PERMANENT;

  const code = String(error.code || '');
  if (code === '429' || code === '57P01') return ErrorCategory.RATE_LIMITED;
  if (code.startsWith('08') || code === '40001') return ErrorCategory.TRANSIENT;

  const status = error.status || error.response?.status;
  if (status === 401 || status === 403) return ErrorCategory.AUTH;
  if (status === 429) return ErrorCategory.RATE_LIMITED;
  if (status >= 500) return ErrorCategory.TRANSIENT;

  return ErrorCategory.TRANSIENT;
}

function isRetryable(error: any): boolean {
  const category = classifyError(error);
  return category === ErrorCategory.TRANSIENT || category === ErrorCategory.RATE_LIMITED;
}

function getBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelayMs;
  return Math.min(exponential + jitter, maxDelayMs);
}

export class ErrorRecovery {
  private maxRetries: number;
  private circuitState: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private failureThreshold: number;
  private resetTimeoutMs: number;
  private baseDelayMs: number;
  private maxDelayMs: number;
  private label: string;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private halfOpenSuccessCount = 0;
  private halfOpenRequired = 2;

  private metrics: RecoveryMetrics = {
    totalAttempts: 0,
    successCount: 0,
    failureCount: 0,
    circuitBreakerTrips: 0,
    lastFailureTime: null,
    lastSuccessTime: null,
  };

  constructor(options: ErrorRecoveryOptions = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60_000;
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.label = options.label ?? 'payment-processor';
  }

  getState(): CircuitState {
    return this.circuitState;
  }

  getMetrics(): RecoveryMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.circuitState = CircuitState.CLOSED;
    this.failureCount = 0;
    this.halfOpenSuccessCount = 0;
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    logger.info({ label: this.label }, 'Error recovery: circuit breaker reset');
  }

  async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    if (this.circuitState === CircuitState.OPEN) {
      const error = new Error(`Circuit breaker is OPEN for ${this.label}`);
      (error as any).category = ErrorCategory.TRANSIENT;
      (error as any).circuitBreakerOpen = true;
      throw error;
    }

    let attempt = 0;
    while (attempt <= this.maxRetries) {
      this.metrics.totalAttempts++;
      try {
        const result = await operation();
        this.onSuccess();
        return result;
      } catch (error) {
        attempt++;
        const category = classifyError(error);
        const retryable = isRetryable(error);

        if (!retryable || attempt > this.maxRetries) {
          this.onFailure();
          logger.error(
            {
              label: this.label,
              attempt,
              category,
              error: (error as any)?.message || String(error),
              circuitState: this.circuitState,
            },
            'Error recovery: operation failed permanently',
          );
          throw error;
        }

        const delayMs = getBackoffDelay(attempt - 1, this.baseDelayMs, this.maxDelayMs);
        logger.warn(
          {
            label: this.label,
            attempt,
            maxRetries: this.maxRetries,
            delayMs,
            category,
            error: (error as any)?.message || String(error),
          },
          'Error recovery: retryable error — retrying with backoff',
        );
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    const error = new Error(`Max retries (${this.maxRetries}) exceeded for ${this.label}`);
    this.onFailure();
    throw error;
  }

  private onSuccess(): void {
    this.metrics.successCount++;
    this.metrics.lastSuccessTime = Date.now();

    if (this.circuitState === CircuitState.HALF_OPEN) {
      this.halfOpenSuccessCount++;
      if (this.halfOpenSuccessCount >= this.halfOpenRequired) {
        this.circuitState = CircuitState.CLOSED;
        this.failureCount = 0;
        this.halfOpenSuccessCount = 0;
        logger.info(
          { label: this.label, successCount: this.halfOpenSuccessCount },
          'Error recovery: circuit breaker CLOSED — service recovered',
        );
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.metrics.failureCount++;
    this.metrics.lastFailureTime = Date.now();

    if (this.circuitState === CircuitState.HALF_OPEN) {
      this.tripCircuitBreaker();
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      this.tripCircuitBreaker();
    }
  }

  private tripCircuitBreaker(): void {
    this.circuitState = CircuitState.OPEN;
    this.metrics.circuitBreakerTrips++;
    this.halfOpenSuccessCount = 0;

    logger.error(
      {
        label: this.label,
        failureCount: this.failureCount,
        resetTimeoutMs: this.resetTimeoutMs,
      },
      'Error recovery: circuit breaker OPEN — pausing operations',
    );

    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }

    this.resetTimer = setTimeout(() => {
      this.circuitState = CircuitState.HALF_OPEN;
      this.halfOpenSuccessCount = 0;
      logger.info(
        { label: this.label },
        'Error recovery: circuit breaker HALF_OPEN — allowing trial requests',
      );
    }, this.resetTimeoutMs);
    // Do not keep the process alive (or retain this instance) just for the reset timer
    this.resetTimer.unref?.();
  }
}

export function createPaymentProcessorRecovery(options: ErrorRecoveryOptions = {}): ErrorRecovery {
  return new ErrorRecovery({
    label: 'payment-processor',
    maxRetries: 3,
    failureThreshold: 5,
    resetTimeoutMs: 60_000,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
    ...options,
  });
}

export function createHorizonRecovery(options: ErrorRecoveryOptions = {}): ErrorRecovery {
  return new ErrorRecovery({
    label: 'horizon-api',
    maxRetries: 3,
    failureThreshold: 10,
    resetTimeoutMs: 120_000,
    baseDelayMs: 500,
    maxDelayMs: 15_000,
    ...options,
  });
}

export function createDatabaseRecovery(options: ErrorRecoveryOptions = {}): ErrorRecovery {
  return new ErrorRecovery({
    label: 'database',
    maxRetries: 2,
    failureThreshold: 5,
    resetTimeoutMs: 60_000,
    baseDelayMs: 150,
    maxDelayMs: 5_000,
    ...options,
  });
}
