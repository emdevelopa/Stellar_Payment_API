/**
 * Robust three-state Circuit Breaker for the Audit Logger (issue #771).
 * Supports CLOSED, OPEN, and HALF_OPEN states following Drips Wave standards.
 *
 * Issue #1433 — Prometheus alert metrics and health telemetry:
 *   Adds Gauge/Counter/Histogram prom-client metrics for circuit state,
 *   state transitions, failures, successes, open duration, health checks,
 *   and retry attempts. Exposes a static getMetrics() helper.
 *
 * Issue #1434 — Automated retry with exponential backoff:
 *   Adds execute(fn, options) method with configurable maxRetries,
 *   baseDelayMs * 2^attempt + jitter formula, optional retryableErrors
 *   filter, and CircuitOpenError for fast-fail when circuit is open.
 */

import client from "prom-client";

// ── Prometheus metrics (self-contained, own sub-registry) ────────────────────
// All metric names are prefixed with `audit_circuit_breaker_` to avoid any
// collision with the application-wide metrics defined in metrics.js.

const _cbRegistry = new client.Registry();

const cbStateGauge = new client.Gauge({
  name: "audit_circuit_breaker_state",
  help: "Current state of the audit circuit breaker (0=CLOSED, 1=OPEN, 2=HALF_OPEN)",
  labelNames: ["label"],
  registers: [_cbRegistry],
});

const cbTransitionsTotal = new client.Counter({
  name: "audit_circuit_breaker_transitions_total",
  help: "Total number of audit circuit breaker state transitions",
  labelNames: ["label", "from_state", "to_state"],
  registers: [_cbRegistry],
});

const cbFailuresTotal = new client.Counter({
  name: "audit_circuit_breaker_failures_total",
  help: "Total number of audit circuit breaker failure recordings",
  labelNames: ["label"],
  registers: [_cbRegistry],
});

const cbSuccessesTotal = new client.Counter({
  name: "audit_circuit_breaker_successes_total",
  help: "Total number of audit circuit breaker success recordings",
  labelNames: ["label"],
  registers: [_cbRegistry],
});

const cbOpenDurationSeconds = new client.Histogram({
  name: "audit_circuit_breaker_open_duration_seconds",
  help: "Duration the audit circuit breaker spent in OPEN state before recovering",
  labelNames: ["label"],
  buckets: [1, 5, 15, 30, 60, 120, 300],
  registers: [_cbRegistry],
});

const cbHealthCheckTotal = new client.Counter({
  name: "audit_circuit_breaker_health_check_total",
  help: "Total number of audit circuit breaker health checks (isOpen calls)",
  labelNames: ["label", "result"],
  registers: [_cbRegistry],
});

const cbRetryAttemptTotal = new client.Counter({
  name: "audit_circuit_breaker_retry_attempt_total",
  help: "Total number of retry attempts made inside execute()",
  labelNames: ["label", "attempt"],
  registers: [_cbRegistry],
});

// ── CircuitOpenError ─────────────────────────────────────────────────────────

/**
 * Thrown by execute() when the circuit is OPEN and the call is short-circuited.
 */
export class CircuitOpenError extends Error {
  constructor(label) {
    super(`Circuit breaker is OPEN for '${label}' — call rejected`);
    this.name = "CircuitOpenError";
    this.code = "CIRCUIT_OPEN";
  }
}

// ── State constants ──────────────────────────────────────────────────────────

export const CircuitState = {
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
};

/** Numeric value for the state gauge (matches the labels in alerting rules). */
const STATE_GAUGE_VALUE = {
  [CircuitState.CLOSED]: 0,
  [CircuitState.OPEN]: 1,
  [CircuitState.HALF_OPEN]: 2,
};

// ── AuditCircuitBreaker ──────────────────────────────────────────────────────

export class AuditCircuitBreaker {
  /**
   * @param {object}   opts
   * @param {number}   [opts.failureThreshold=5]      - Failures before OPEN
   * @param {number}   [opts.resetTimeoutMs=60000]     - OPEN hold time in ms
   * @param {number}   [opts.halfOpenRequired=2]       - Successes to re-CLOSE
   * @param {string}   [opts.label="circuit-breaker"]  - Label for logs & metrics
   * @param {Function} [opts.onClose]                  - Callback on CLOSED transition
   * @param {Function} [opts.onOpen]                   - Callback on OPEN transition
   * @param {Function} [opts.onHalfOpen]               - Callback on HALF_OPEN transition
   * @param {number}   [opts.maxRetries=3]             - Max retries in execute()
   * @param {number}   [opts.retryBaseDelayMs=100]     - Base delay for backoff in execute()
   * @param {string[]} [opts.retryableErrors]          - Substrings; all errors retried if absent
   */
  constructor({
    failureThreshold = 5,
    resetTimeoutMs = 60000,
    halfOpenRequired = 2,
    label = "circuit-breaker",
    onClose = null,
    onOpen = null,
    onHalfOpen = null,
    maxRetries = 3,
    retryBaseDelayMs = 100,
    retryableErrors = null,
  } = {}) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.halfOpenRequired = halfOpenRequired;
    this.label = label;
    this.onClose = onClose;
    this.onOpen = onOpen;
    this.onHalfOpen = onHalfOpen;
    this.maxRetries = maxRetries;
    this.retryBaseDelayMs = retryBaseDelayMs;
    this.retryableErrors = retryableErrors;

    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.openedAt = null;
    this.halfOpenSuccesses = 0;

    // Initialise gauge to CLOSED (0) so Prometheus has a value from the start.
    cbStateGauge.set({ label: this.label }, STATE_GAUGE_VALUE[CircuitState.CLOSED]);
  }

  // ── Core state machine ────────────────────────────────────────────────────

  /**
   * Returns true if the circuit is currently blocking calls.
   * Side-effect: may transition OPEN → HALF_OPEN when the reset timeout elapses.
   *
   * @param {number} [now=Date.now()]
   * @returns {boolean}
   */
  isOpen(now = Date.now()) {
    if (this.state === CircuitState.OPEN) {
      if (now - this.openedAt >= this.resetTimeoutMs) {
        const fromState = CircuitState.OPEN;
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenSuccesses = 0;

        cbStateGauge.set({ label: this.label }, STATE_GAUGE_VALUE[CircuitState.HALF_OPEN]);
        cbTransitionsTotal.inc({ label: this.label, from_state: fromState, to_state: CircuitState.HALF_OPEN });
        cbHealthCheckTotal.inc({ label: this.label, result: "closed" });

        console.info(
          `[${this.label}] Circuit breaker transitioned to HALF_OPEN — allowing trial requests`,
        );
        if (typeof this.onHalfOpen === "function") {
          this.onHalfOpen();
        }
        return false;
      }

      cbHealthCheckTotal.inc({ label: this.label, result: "open" });
      return true;
    }

    cbHealthCheckTotal.inc({ label: this.label, result: "closed" });
    return false;
  }

  /**
   * Record a successful operation.
   * In HALF_OPEN, accumulates successes and may transition to CLOSED.
   */
  recordSuccess() {
    cbSuccessesTotal.inc({ label: this.label });

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.halfOpenRequired) {
        const fromState = CircuitState.HALF_OPEN;

        // Observe how long the circuit was open before recovering.
        if (this.openedAt !== null) {
          const openDurationSeconds = (Date.now() - this.openedAt) / 1000;
          cbOpenDurationSeconds.observe({ label: this.label }, openDurationSeconds);
        }

        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.halfOpenSuccesses = 0;
        this.openedAt = null;

        cbStateGauge.set({ label: this.label }, STATE_GAUGE_VALUE[CircuitState.CLOSED]);
        cbTransitionsTotal.inc({ label: this.label, from_state: fromState, to_state: CircuitState.CLOSED });

        console.info(`[${this.label}] Circuit breaker CLOSED — service recovered`);
        if (typeof this.onClose === "function") {
          this.onClose();
        }
      }
    } else {
      // CLOSED state: reset consecutive failure counter on success
      this.failures = 0;
    }
  }

  /**
   * Record a failed operation.
   * Trips circuit to OPEN when failureThreshold is reached or in HALF_OPEN.
   *
   * @param {number} [now=Date.now()]
   */
  recordFailure(now = Date.now()) {
    cbFailuresTotal.inc({ label: this.label });
    this.failures += 1;

    // In HALF_OPEN, any failure immediately trips back to OPEN.
    // In CLOSED, failureThreshold consecutive failures trip to OPEN.
    if (this.state === CircuitState.HALF_OPEN || this.failures >= this.failureThreshold) {
      const fromState = this.state;
      this.state = CircuitState.OPEN;
      this.openedAt = now;
      this.halfOpenSuccesses = 0;

      cbStateGauge.set({ label: this.label }, STATE_GAUGE_VALUE[CircuitState.OPEN]);
      cbTransitionsTotal.inc({ label: this.label, from_state: fromState, to_state: CircuitState.OPEN });

      console.warn(
        `[${this.label}] Circuit breaker opened after ${this.failures} failures. DB writes suspended for ${this.resetTimeoutMs}ms.`,
      );
      if (typeof this.onOpen === "function") {
        this.onOpen();
      }
    }
  }

  /**
   * Forcefully reset to CLOSED (useful for tests and manual recovery).
   */
  reset() {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.openedAt = null;
    this.halfOpenSuccesses = 0;

    cbStateGauge.set({ label: this.label }, STATE_GAUGE_VALUE[CircuitState.CLOSED]);
  }

  // ── execute() with exponential backoff (Issue #1434) ─────────────────────

  /**
   * Execute an async function with circuit-breaker protection and automatic
   * exponential-backoff retries.
   *
   * Retry formula:  delay = retryBaseDelayMs * (2 ** attempt) + jitter(0–100ms)
   *
   * @param {Function} fn                         - Async function to execute
   * @param {object}   [options={}]               - Per-call overrides
   * @param {number}   [options.maxRetries]        - Override constructor maxRetries
   * @param {number}   [options.baseDelayMs]       - Override constructor retryBaseDelayMs
   * @param {string[]} [options.retryableErrors]   - Override constructor retryableErrors
   * @returns {Promise<*>}
   * @throws {CircuitOpenError} when the circuit is OPEN
   * @throws {Error}            when all retries are exhausted
   */
  async execute(fn, options = {}) {
    if (this.isOpen()) {
      throw new CircuitOpenError(this.label);
    }

    const maxRetries = options.maxRetries ?? this.maxRetries;
    const baseDelayMs = options.baseDelayMs ?? this.retryBaseDelayMs;
    const retryableErrors = options.retryableErrors ?? this.retryableErrors;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn();
        this.recordSuccess();
        return result;
      } catch (err) {
        lastError = err;

        // Decide whether this error is retryable.
        const isRetryable = _isRetryable(err, retryableErrors);

        if (!isRetryable || attempt >= maxRetries) {
          // Either non-retryable or out of retries — record failure and throw.
          this.recordFailure();
          throw lastError;
        }

        // Emit retry metric and wait before the next attempt.
        cbRetryAttemptTotal.inc({ label: this.label, attempt: String(attempt + 1) });

        const jitter = Math.floor(Math.random() * 101); // 0–100 ms
        const delayMs = baseDelayMs * (2 ** attempt) + jitter;

        await _sleep(delayMs);

        // Re-check circuit state between retries (another caller might have
        // tripped it while we were waiting).
        if (this.isOpen()) {
          throw new CircuitOpenError(this.label);
        }
      }
    }

    // Should not be reachable, but guard anyway.
    this.recordFailure();
    throw lastError;
  }

  // ── Static helpers ────────────────────────────────────────────────────────

  /**
   * Returns the prom-client Registry containing only the circuit-breaker
   * metrics defined in this module.
   *
   * @returns {import("prom-client").Registry}
   */
  static getMetrics() {
    return _cbRegistry;
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true if the error should be retried.
 *
 * @param {Error}    err
 * @param {string[]|null} retryableErrors - substrings to match; null means all retried
 * @returns {boolean}
 */
function _isRetryable(err, retryableErrors) {
  if (!retryableErrors || retryableErrors.length === 0) {
    return true;
  }
  const msg = err?.message ?? "";
  return retryableErrors.some((substr) => msg.includes(substr));
}
