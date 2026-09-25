/**
 * websocket-relay-recovery.js
 *
 * Error-recovery primitives for the WebSocket relay:
 *   - Exponential backoff reconnection
 *   - Circuit breaker (CLOSED → OPEN → HALF_OPEN)
 *   - Dead letter queue (DLQ) for undeliverable messages
 *   - Health snapshot
 */

// ─── Circuit breaker states ───────────────────────────────────────────────────

const CircuitState = Object.freeze({
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
});

// ─── Exponential backoff reconnect ───────────────────────────────────────────

/**
 * Attempt to (re)connect using an exponential backoff schedule.
 *
 * Delays are calculated as:
 *   delay = min(baseDelayMs * 2^attempt + jitter, maxDelayMs)
 *
 * A small random jitter (±10 % of the computed delay) is added so that
 * multiple relay instances don't stampede the server at the same moment.
 *
 * @param {() => Promise<any>} connectFn  - Async function that establishes the connection.
 *                                          Resolves on success, throws on failure.
 * @param {object}  [opts]
 * @param {number}  [opts.maxRetries=5]         - Maximum number of retries (0 = try once)
 * @param {number}  [opts.baseDelayMs=1000]      - Initial delay in milliseconds
 * @param {number}  [opts.maxDelayMs=30000]      - Maximum delay cap in milliseconds
 * @param {Function}[opts.sleep]                 - Injectable sleep (defaults to setTimeout promise); useful for testing
 * @returns {Promise<any>} Resolves with the value returned by connectFn
 * @throws  {Error}        Re-throws the last error when all retries are exhausted
 */
async function reconnectWithBackoff(connectFn, opts = {}) {
  const {
    maxRetries = 5,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = opts;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await connectFn();
    } catch (err) {
      lastError = err;

      if (attempt === maxRetries) {
        break;
      }

      const exponential = baseDelayMs * Math.pow(2, attempt);
      const capped = Math.min(exponential, maxDelayMs);
      // ±10 % jitter
      const jitter = capped * 0.1 * (Math.random() * 2 - 1);
      const delay = Math.max(0, Math.round(capped + jitter));

      await sleep(delay);
    }
  }

  throw lastError;
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

/**
 * A three-state circuit breaker that protects downstream dependencies.
 *
 *   CLOSED    → normal operation; failures are counted.
 *   OPEN      → fast-fail; calls are rejected immediately.
 *   HALF_OPEN → one probe call is allowed through to test recovery.
 *
 * @param {object} [opts]
 * @param {number} [opts.failureThreshold=5]   - Consecutive failures before the circuit opens
 * @param {number} [opts.resetTimeoutMs=30000] - Time (ms) before trying HALF_OPEN
 * @param {Function}[opts.now]                 - Injectable clock (defaults to Date.now); useful for testing
 */
class CircuitBreaker {
  constructor(opts = {}) {
    this._failureThreshold = opts.failureThreshold ?? 5;
    this._resetTimeoutMs = opts.resetTimeoutMs ?? 30000;
    this._now = opts.now ?? (() => Date.now());

    this._state = CircuitState.CLOSED;
    this._failureCount = 0;
    this._openedAt = null;
    this._lastError = null;
  }

  get state() {
    return this._state;
  }

  /**
   * Execute `fn` through the circuit breaker.
   *
   * @param {() => Promise<any>} fn
   * @returns {Promise<any>}
   * @throws {Error} When the circuit is OPEN, or when `fn` fails
   */
  async call(fn) {
    if (this._state === CircuitState.OPEN) {
      // Check whether reset timeout has elapsed
      if (this._now() - this._openedAt >= this._resetTimeoutMs) {
        this._state = CircuitState.HALF_OPEN;
      } else {
        const err = new Error("Circuit breaker is OPEN — call rejected");
        err.circuitOpen = true;
        throw err;
      }
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    }
  }

  _onSuccess() {
    this._failureCount = 0;
    this._lastError = null;
    this._state = CircuitState.CLOSED;
  }

  _onFailure(err) {
    this._lastError = err;
    this._failureCount += 1;

    if (
      this._state === CircuitState.HALF_OPEN ||
      this._failureCount >= this._failureThreshold
    ) {
      this._state = CircuitState.OPEN;
      this._openedAt = this._now();
    }
  }

  /** Return a plain-object snapshot suitable for health checks. */
  getStatus() {
    return {
      state: this._state,
      failureCount: this._failureCount,
      lastError: this._lastError ? this._lastError.message : null,
    };
  }
}

// ─── Dead Letter Queue ────────────────────────────────────────────────────────

/**
 * In-memory dead letter queue for relay messages that could not be delivered.
 *
 * Each entry records the original message, the error that caused the failure,
 * the retry count, and a timestamp for TTL-based cleanup.
 */
class DeadLetterQueue {
  constructor() {
    this._entries = [];
  }

  /**
   * Push a failed message onto the DLQ.
   *
   * @param {any}   message   - The original relay message
   * @param {Error} error     - The error that caused the failure
   * @param {number}[retryCount=0] - How many delivery attempts have been made
   */
  push(message, error, retryCount = 0) {
    this._entries.push({
      message,
      errorMessage: error instanceof Error ? error.message : String(error),
      retryCount,
      failedAt: new Date().toISOString(),
    });
  }

  /**
   * Return a shallow copy of all current DLQ entries.
   *
   * @returns {object[]}
   */
  getAll() {
    return [...this._entries];
  }

  /**
   * Remove and return the oldest DLQ entry, or null if the queue is empty.
   *
   * @returns {object|null}
   */
  shift() {
    return this._entries.shift() || null;
  }

  /** Number of entries currently in the queue. */
  get size() {
    return this._entries.length;
  }

  /** Remove all entries. */
  clear() {
    this._entries = [];
  }
}

// ─── Relay Health ─────────────────────────────────────────────────────────────

/**
 * Aggregate health snapshot from the relay's circuit breaker and DLQ.
 *
 * @param {object} opts
 * @param {CircuitBreaker}  opts.circuitBreaker  - The relay's CircuitBreaker instance
 * @param {DeadLetterQueue} opts.dlq             - The relay's DeadLetterQueue instance
 * @param {number}          [opts.reconnectCount=0] - How many reconnections have occurred
 * @returns {{ status: string, reconnectCount: number, circuitState: string, dlqSize: number, lastError: string|null }}
 */
function getRelayHealth({ circuitBreaker, dlq, reconnectCount = 0 }) {
  const cbStatus = circuitBreaker.getStatus();
  const isHealthy = cbStatus.state === CircuitState.CLOSED && dlq.size === 0;

  return {
    status: isHealthy ? "healthy" : "degraded",
    reconnectCount,
    circuitState: cbStatus.state,
    dlqSize: dlq.size,
    lastError: cbStatus.lastError,
  };
}

export {
  CircuitState,
  CircuitBreaker,
  DeadLetterQueue,
  getRelayHealth,
  reconnectWithBackoff,
};
