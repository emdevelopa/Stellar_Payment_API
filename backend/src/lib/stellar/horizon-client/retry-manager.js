/**
 * Horizon Client Retry Manager
 *
 * Runs Horizon reads with automated retries.
 *
 * Retry policy (issue #1439)
 *   - Jittered exponential backoff by default (see backoff.js). An explicit
 *     `retryDelays` array keeps the legacy fixed schedule.
 *   - Retry-After from Horizon is honoured: the wait is at least the hint, and
 *     a hint above maxRetryAfterMs fails fast instead of pinning the caller.
 *   - A total time budget (maxElapsedMs) bounds every operation, including
 *     all waits, so retries can never stretch a request indefinitely.
 *   - Only transient failures are retried (isRetryableError). Errors flagged
 *     `retryable: false` are never retried.
 *
 * Concurrency control (issue #1440)
 *   - ConcurrencyLimiter: per-process cap on in-flight Horizon operations with
 *     a bounded queue; overflow is rejected with 503 instead of piling up.
 *   - HorizonRetryCoordinator: cluster-wide retry slots (Redis SET NX PX +
 *     compare-and-delete release) and a shared Retry-After cooldown, so N
 *     instances do not multiply a Horizon outage into a retry storm. Falls
 *     back to an in-process implementation when Redis is unavailable.
 *
 * All operations wrapped here are idempotent reads, so retrying them cannot
 * duplicate a payment.
 */

import { logger } from "../../logger.js";
import {
  horizonClientErrors,
  horizonClientOperations,
  horizonClientRetries,
  horizonClientLatency,
  horizonClientOperationDuration,
  horizonClientRetryAttemptDuration,
  horizonClientErrorRecovery,
  horizonClientConcurrentOperations,
  horizonClientBackpressure,
  horizonClientQueueDepth,
  horizonClientRateLimitWaitTime,
  horizonClientConsecutiveFailures,
  horizonClientLastSuccessTimestamp,
  horizonClientHealthState,
} from "../../metrics.js";
import { classifyError, getErrorStatus, handleError, isRetryableError } from "./error-handler.js";
import { computeBackoffDelay, parseRetryAfterMs, resolveBackoffOptions } from "./backoff.js";
import { ConcurrencyLimiter } from "./concurrency-limiter.js";
import { HorizonRetryCoordinator } from "./retry-coordinator.js";

/** Why the manager stopped retrying - attached to the thrown error. */
export const RETRY_STOP_REASONS = Object.freeze({
  NOT_RETRYABLE: "not_retryable",
  EXHAUSTED: "exhausted",
  BUDGET_EXCEEDED: "budget_exceeded",
  RETRY_AFTER_TOO_LONG: "retry_after_too_long",
  RETRY_SLOTS_EXHAUSTED: "retry_slots_exhausted",
});

/**
 * Metrics must never break the request path. Some test suites mock
 * metrics.js with only a subset of exports, and a prom-client label mismatch
 * throws synchronously; both cases are swallowed here.
 */
function recordMetric(fn) {
  try {
    fn();
  } catch {
    // ignore
  }
}

export const HealthStatus = Object.freeze({
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  UNHEALTHY: "unhealthy",
});

const HEALTH_STATE_VALUE = Object.freeze({
  [HealthStatus.HEALTHY]: 0,
  [HealthStatus.DEGRADED]: 1,
  [HealthStatus.UNHEALTHY]: 2,
});

export const DEFAULT_UNHEALTHY_AFTER_FAILURES = 5;
// Bound the per-operation health table; operation names are validated, but a
// caller generating names dynamically must not grow it without limit.
const MAX_TRACKED_OPERATIONS = 64;

function resolveUnhealthyThreshold(value) {
  const raw = Number(value ?? DEFAULT_UNHEALTHY_AFTER_FAILURES);
  if (!Number.isInteger(raw) || raw < 1) return DEFAULT_UNHEALTHY_AFTER_FAILURES;
  return Math.min(raw, 1_000);
}
const defaultSleep = (ms) =>
  new Promise((resolve) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

/**
 * Retry manager class with configurable retry strategy
 */
export class RetryManager {
  /**
   * @param {number[]|undefined} retryDelays legacy fixed schedule; omit for exponential backoff
   * @param {object} [options]
   * @param {object} [options.backoff]      see resolveBackoffOptions
   * @param {object} [options.concurrency]  see resolveConcurrencyOptions
   * @param {object} [options.coordination] see HorizonRetryCoordinator
   * @param {HorizonRetryCoordinator} [options.coordinator]
   * @param {ConcurrencyLimiter} [options.limiter]
   * @param {string} [options.horizonUrl]
   * @param {(ms:number) => Promise<void>} [options.sleep]  injectable for tests
   * @param {() => number} [options.random]                 injectable for tests
   * @param {string} [options.metricsPrefix]                kept for compatibility
   */
  constructor(retryDelays, options = {}) {
    // Backwards compatibility: the second positional argument used to be
    // `metricsPrefix`.
    const opts = typeof options === "string" ? { metricsPrefix: options } : options ?? {};

    this.policy = resolveBackoffOptions({ ...(opts.backoff ?? {}), retryDelays });
    this.retryDelays = this.policy.fixedDelays ?? retryDelays ?? [];
    this.metricsPrefix = opts.metricsPrefix ?? "";
    this.horizonUrl = opts.horizonUrl ?? "default";
    this.sleep = typeof opts.sleep === "function" ? opts.sleep : defaultSleep;
    this.random = typeof opts.random === "function" ? opts.random : Math.random;

    this.limiter =
      opts.limiter ??
      new ConcurrencyLimiter({
        ...(opts.concurrency ?? {}),
        onQueueChange: (depth) => recordMetric(() => horizonClientQueueDepth.set(depth)),
      });
    this.coordinator =
      opts.coordinator ??
      new HorizonRetryCoordinator({ ...(opts.coordination ?? {}), horizonUrl: this.horizonUrl });

    this.concurrentOperations = 0;
    this.unhealthyAfterFailures = resolveUnhealthyThreshold(options.unhealthyAfterFailures);
    this._now = typeof options.now === "function" ? options.now : () => Date.now();
    this.operationHealth = new Map();
  }

  /**
   * Swap the retry coordinator (e.g. once Redis is connected at startup).
   * In-flight operations keep the coordinator they started with.
   */
  setCoordinator(coordinator) {
    if (!(coordinator instanceof HorizonRetryCoordinator)) {
      throw new TypeError("setCoordinator expects a HorizonRetryCoordinator");
    }
    this.coordinator = coordinator;
  }

  /**
   * Execute operation with automatic retry logic
   */
  async executeWithRetry(operation, operationName, context = {}, horizonUrl) {
    let releaseSlot;
    try {
      releaseSlot = await this.limiter.acquire(operationName);
    } catch (err) {
      // Load shed before reaching Horizon.
      recordMetric(() => horizonClientBackpressure.inc({ operation: operationName }));
      this._recordError(operationName, err);
      logger.warn(
        { operation: operationName, code: err?.code, ...this._safeContext(context) },
        "Horizon client: request rejected by concurrency limiter",
      );
      throw err;
    }

    const totalStartTime = Date.now();
    const deadline = totalStartTime + this.policy.maxElapsedMs;
    const coordinator = this.coordinator;
    this.concurrentOperations++;
    recordMetric(() => horizonClientConcurrentOperations.inc());

    let retryPermit = null;
    try {
      let lastError = null;

      for (let attempt = 0; attempt <= this.policy.maxRetries; attempt += 1) {
        await this._waitForCooldown(coordinator, operationName, deadline);

        const attemptStartTime = Date.now();
        try {
          const result = await operation();
          this._observeAttempt(operationName, attempt, attemptStartTime);
          this._recordSuccess(operationName, totalStartTime);

          if (attempt > 0) {
            recordMetric(() =>
              horizonClientErrorRecovery.inc({
                operation: operationName,
                error_type: classifyError(lastError),
                recovery_attempt: attempt,
              }),
            );
          }
          return result;
        } catch (err) {
          lastError = err;
          this._observeAttempt(operationName, attempt, attemptStartTime);
        } finally {
          if (retryPermit) {
            await retryPermit.release();
            retryPermit = null;
          }
        }

        const decision = await this._planRetry(lastError, attempt, deadline, coordinator, operationName);
        if (decision.stop) {
          this._recordError(operationName, lastError);
          this._logGiveUp(operationName, attempt + 1, decision.reason, lastError, context);
          throw this._finalError(lastError, operationName, context, horizonUrl, attempt + 1, decision.reason);
        }

        retryPermit = decision.permit;
        this._recordRetry(operationName);
        this._logRetry(operationName, attempt + 1, decision.delayMs, lastError, context);
        await this.sleep(decision.delayMs);
      }

      // Unreachable: the loop either returns or throws.
      throw this._finalError(
        lastError,
        operationName,
        context,
        horizonUrl,
        this.policy.maxRetries + 1,
        RETRY_STOP_REASONS.EXHAUSTED,
      );
    } finally {
      if (retryPermit) await retryPermit.release();
      releaseSlot();
      this.concurrentOperations--;
      recordMetric(() => horizonClientConcurrentOperations.dec());

      const totalDuration = (Date.now() - totalStartTime) / 1000;
      recordMetric(() =>
        horizonClientOperationDuration.observe({ operation: operationName, phase: "total" }, totalDuration),
      );
    }
  }

  /**
   * Decide whether (and how long) to wait before the next attempt.
   * @private
   * @returns {Promise<{stop: true, reason: string} | {stop: false, delayMs: number, permit: object}>}
   */
  async _planRetry(err, attempt, deadline, coordinator, operationName) {
    if (err?.retryable === false || !isRetryableError(err)) {
      return { stop: true, reason: RETRY_STOP_REASONS.NOT_RETRYABLE };
    }
    if (attempt >= this.policy.maxRetries) {
      return { stop: true, reason: RETRY_STOP_REASONS.EXHAUSTED };
    }

    const status = getErrorStatus(err);
    const retryAfterMs = parseRetryAfterMs(err);

    if (status === 429 || status === 503) {
      // Share the throttle signal with every instance, even if we stop here.
      await coordinator.recordCooldown(retryAfterMs ?? computeBackoffDelay(attempt, this.policy, () => 1));
    }

    if (retryAfterMs !== null && retryAfterMs > this.policy.maxRetryAfterMs) {
      return { stop: true, reason: RETRY_STOP_REASONS.RETRY_AFTER_TOO_LONG };
    }

    const delayMs = Math.max(computeBackoffDelay(attempt, this.policy, this.random), retryAfterMs ?? 0);
    if (Date.now() + delayMs >= deadline) {
      return { stop: true, reason: RETRY_STOP_REASONS.BUDGET_EXCEEDED };
    }

    const permit = await coordinator.acquireRetrySlot(operationName, {
      leaseMs: delayMs + Math.max(deadline - Date.now(), 0),
    });
    if (!permit) {
      recordMetric(() => horizonClientBackpressure.inc({ operation: operationName }));
      return { stop: true, reason: RETRY_STOP_REASONS.RETRY_SLOTS_EXHAUSTED };
    }

    return { stop: false, delayMs, permit };
  }

  /**
   * Wait out a shared rate-limit cooldown, never past the operation deadline.
   * @private
   */
  async _waitForCooldown(coordinator, operationName, deadline) {
    let remaining = 0;
    try {
      remaining = await coordinator.getCooldownRemainingMs();
    } catch {
      return;
    }
    const waitMs = Math.min(remaining, Math.max(deadline - Date.now(), 0));
    if (waitMs <= 0) return;
    recordMetric(() => horizonClientRateLimitWaitTime.observe(waitMs / 1000));
    logger.debug?.({ operation: operationName, waitMs }, "Horizon client: waiting for shared rate-limit cooldown");
    await this.sleep(waitMs);
  }

  /** @private */
  _finalError(err, operationName, context, horizonUrl, attempts, reason) {
    const wrapped = handleError(err ?? new Error("Unknown Horizon error"), operationName, context, horizonUrl);
    wrapped.attempts = attempts;
    wrapped.retryStopReason = reason;
    if (err?.code && !wrapped.code) wrapped.code = err.code;
    return wrapped;
  }

  /** @private */
  _observeAttempt(operationName, attempt, attemptStartTime) {
    const attemptDuration = (Date.now() - attemptStartTime) / 1000;
    recordMetric(() =>
      horizonClientRetryAttemptDuration.observe({ operation: operationName, attempt: attempt + 1 }, attemptDuration),
    );
  }

  /**
   * Record successful operation metrics
   * @private
   */
  _recordSuccess(operationName, startTime) {
    recordMetric(() => horizonClientOperations.inc({ operation: operationName, result: "success" }));
    recordMetric(() =>
      horizonClientLatency.observe(
        { operation: operationName, result: "success" },
        (Date.now() - startTime) / 1000,
      ),
    );
  }

  /**
   * Record error metrics
   * @private
   */
  _recordError(operationName, err) {
    recordMetric(() => horizonClientOperations.inc({ operation: operationName, result: "error" }));
    recordMetric(() => horizonClientErrors.inc({ operation: operationName, error_type: classifyError(err) }));
  }

  /**
   * Record retry metrics
   * @private
   */
  _recordRetry(operationName) {
    recordMetric(() => horizonClientRetries.inc({ operation: operationName }));
  }

  /**
   * Only primitive context values reach the logs; nested objects are dropped
   * so request payloads cannot leak through retry logging.
   * @private
   */
  _safeContext(context) {
    const safe = {};
    for (const [key, value] of Object.entries(context ?? {})) {
      if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
        safe[key] = value;
      }
    }
    return safe;
  }

  /**
   * Get (or create) the health entry for an operation.
   * @private
   */
  _healthEntry(operationName) {
    let entry = this.operationHealth.get(operationName);
    if (!entry) {
      if (this.operationHealth.size >= MAX_TRACKED_OPERATIONS) {
        return null;
      }
      entry = {
        consecutiveFailures: 0,
        totalSuccesses: 0,
        totalFailures: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastErrorType: null,
      };
      this.operationHealth.set(operationName, entry);
    }
    return entry;
  }

  /**
   * Horizon responded (success or a non-retryable client error).
   * @private
   */
  _markReachable(operationName, err) {
    const entry = this._healthEntry(operationName);
    if (!entry) return;
    const now = this._now();
    entry.consecutiveFailures = 0;
    if (err) {
      entry.lastErrorType = classifyError(err);
    } else {
      entry.totalSuccesses += 1;
      entry.lastSuccessAt = now;
      horizonClientLastSuccessTimestamp.set({ operation: operationName }, Math.floor(now / 1000));
    }
    horizonClientConsecutiveFailures.set({ operation: operationName }, 0);
    this._publishHealthState();
  }

  /**
   * Horizon was unreachable / failing after all retries.
   * @private
   */
  _markFailure(operationName, err) {
    const entry = this._healthEntry(operationName);
    if (!entry) return;
    entry.consecutiveFailures += 1;
    entry.totalFailures += 1;
    entry.lastFailureAt = this._now();
    entry.lastErrorType = classifyError(err);
    horizonClientConsecutiveFailures.set({ operation: operationName }, entry.consecutiveFailures);
    this._publishHealthState();
    if (entry.consecutiveFailures === this.unhealthyAfterFailures) {
      logger.error(
        {
          operation: operationName,
          consecutiveFailures: entry.consecutiveFailures,
          errorType: entry.lastErrorType,
        },
        "Horizon client: operation is unhealthy after consecutive failures"
      );
    }
  }

  /** @private */
  _statusFor(entry) {
    if (entry.consecutiveFailures === 0) return HealthStatus.HEALTHY;
    if (entry.consecutiveFailures >= this.unhealthyAfterFailures) return HealthStatus.UNHEALTHY;
    return HealthStatus.DEGRADED;
  }

  /** @private */
  _publishHealthState() {
    horizonClientHealthState.set(HEALTH_STATE_VALUE[this.getHealth().status]);
  }

  /**
   * Health telemetry snapshot for health endpoints and alert context.
   *
   * @returns {{ status: string, unhealthyAfterFailures: number, concurrentOperations: number,
   *   operations: Record<string, object> }}
   */
  getHealth() {
    const operations = {};
    let worst = HealthStatus.HEALTHY;
    for (const [name, entry] of this.operationHealth) {
      const status = this._statusFor(entry);
      if (HEALTH_STATE_VALUE[status] > HEALTH_STATE_VALUE[worst]) worst = status;
      operations[name] = {
        status,
        consecutiveFailures: entry.consecutiveFailures,
        totalSuccesses: entry.totalSuccesses,
        totalFailures: entry.totalFailures,
        lastSuccessAt: entry.lastSuccessAt ? new Date(entry.lastSuccessAt).toISOString() : null,
        lastFailureAt: entry.lastFailureAt ? new Date(entry.lastFailureAt).toISOString() : null,
        lastErrorType: entry.lastErrorType,
      };
    }
    return {
      status: worst,
      unhealthyAfterFailures: this.unhealthyAfterFailures,
      concurrentOperations: this.concurrentOperations,
      operations,
    };
  }

  /**
   * Log retry attempt
   * @private
   */
  _logRetry(operationName, attempt, delayMs, error, context) {
    logger.warn(
      {
        operation: operationName,
        attempt,
        delayMs,
        status: getErrorStatus(error),
        error: error?.message,
        ...this._safeContext(context),
      },
      "Horizon client: retrying operation after error",
    );
  }

  /** @private */
  _logGiveUp(operationName, attempts, reason, error, context) {
    if (reason === RETRY_STOP_REASONS.NOT_RETRYABLE) return;
    logger.warn(
      {
        operation: operationName,
        attempts,
        reason,
        status: getErrorStatus(error),
        error: error?.message,
        ...this._safeContext(context),
      },
      "Horizon client: giving up on operation",
    );
  }

  /**
   * Sleep helper (kept for compatibility with callers that stub it)
   * @private
   */
  _sleep(ms) {
    return this.sleep(ms);
  }

  /**
   * Get retry configuration
   */
  getConfig() {
    return {
      retryDelays: this.retryDelays,
      maxAttempts: this.policy.maxRetries + 1,
      currentConcurrentOperations: this.concurrentOperations,
      backoff: { ...this.policy },
      concurrency: this.limiter.getStats(),
      coordination: this.coordinator.getConfig(),
    };
  }
}

/**
 * Create a retry manager with default configuration
 */
export function createRetryManager(retryDelays, options = {}) {
  return new RetryManager(retryDelays, options);
}
