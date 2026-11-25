/**
 * recovery-queue.js
 *
 * A small, bounded dead-letter queue with automated recovery, shared by the
 * Public Hosted Checkout Session Route (#1776) and the Merchant Onboarding and
 * Key Lifecycle Route (#1771).
 *
 * What it guarantees
 * ------------------
 *   - Bounded memory: at most `maxCapacity` entries. When full, the oldest
 *     exhausted entry is evicted first, then the oldest pending one.
 *   - De-duplication: enqueueing the same `key` again refreshes the existing
 *     entry instead of adding a second one, so a hot failing resource cannot
 *     flood the queue.
 *   - Full-jitter exponential backoff between recovery attempts.
 *   - Poison-pill isolation: after `maxAttempts` failed recoveries, or on an
 *     error that is explicitly not retryable (`err.retryable === false`), the
 *     entry is marked `exhausted` and is never retried automatically again.
 *   - No overlapping recovery runs for one queue (`recover()` is re-entrancy
 *     safe) and a bounded batch size per run.
 *   - Only safe fields are exposed: `list()` omits the payload, and error
 *     messages are control-character stripped and truncated.
 *
 * Callers must keep secrets (API keys, webhook secrets, passwords) OUT of
 * payloads. Queue entries are held in process memory and are lost on restart;
 * they exist to absorb transient outages, not to be a durable store.
 */

import { randomUUID } from "node:crypto";
import { logger as defaultLogger } from "./logger.js";

const MAX_ERROR_MESSAGE_LENGTH = 200;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

export function sanitizeErrorMessage(err) {
  const raw = err instanceof Error ? err.message : String(err ?? "unknown error");
  return raw.replace(CONTROL_CHARS, " ").slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export class RecoveryQueue {
  /**
   * @param {object} [options]
   * @param {string} [options.name]            Label used in logs
   * @param {number} [options.maxCapacity=500]
   * @param {number} [options.maxAttempts=5]    Recovery attempts before an entry is exhausted
   * @param {number} [options.baseDelayMs=1000]
   * @param {number} [options.maxDelayMs=60000]
   * @param {() => number} [options.now]
   * @param {() => number} [options.random]
   * @param {{ onDepth?: (n:number)=>void, onOperation?: (action:string, status:string)=>void }} [options.metrics]
   * @param {object} [options.logger]
   */
  constructor(options = {}) {
    this.name = options.name || "recovery-queue";
    this.maxCapacity = clampInt(options.maxCapacity, 500, 1, 10_000);
    this.maxAttempts = clampInt(options.maxAttempts, 5, 1, 20);
    this.baseDelayMs = clampInt(options.baseDelayMs, 1_000, 0, 600_000);
    this.maxDelayMs = clampInt(options.maxDelayMs, 60_000, this.baseDelayMs, 3_600_000);
    this.now = options.now || Date.now;
    this.random = options.random || Math.random;
    this.metrics = options.metrics || {};
    this.logger = options.logger || defaultLogger;
    this._entries = new Map(); // key -> entry
    this._recovering = false;
  }

  get size() {
    return this._entries.size;
  }

  stats() {
    let pending = 0;
    let exhausted = 0;
    for (const entry of this._entries.values()) {
      if (entry.status === "exhausted") exhausted += 1;
      else pending += 1;
    }
    return { total: this._entries.size, pending, exhausted };
  }

  /** Entries without their payload, safe to expose to operators. */
  list() {
    return [...this._entries.values()].map(({ payload: _payload, ...safe }) => ({ ...safe }));
  }

  has(key) {
    return this._entries.has(key);
  }

  _delayFor(attempts) {
    const exponent = Math.min(Math.max(attempts, 0), 30);
    const ceiling = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** exponent);
    if (!Number.isFinite(ceiling) || ceiling <= 0) return 0;
    const r = Math.min(Math.max(Number(this.random()) || 0, 0), 1);
    return Math.floor(r * ceiling);
  }

  _publishDepth() {
    this.metrics.onDepth?.(this._entries.size);
  }

  _record(action, status) {
    this.metrics.onOperation?.(action, status);
  }

  _evictOne() {
    let victimKey = null;
    for (const [key, entry] of this._entries) {
      if (entry.status === "exhausted") {
        victimKey = key;
        break;
      }
      if (victimKey === null) victimKey = key;
    }
    if (victimKey !== null) {
      this._entries.delete(victimKey);
      this._record("evict", "capacity");
      this.logger.warn?.({ queue: this.name }, "Recovery queue at capacity; evicted an entry");
    }
  }

  /**
   * Add a failed unit of work. Re-enqueueing an existing key refreshes its error
   * and, if it was exhausted, leaves it exhausted.
   *
   * @param {string} key      Stable identity of the work (e.g. a tx id)
   * @param {object} payload  Data the recovery handler needs. NO secrets.
   * @param {unknown} error   The failure that sent it here
   */
  enqueue(key, payload, error) {
    if (!key || typeof key !== "string") {
      throw new TypeError("RecoveryQueue.enqueue requires a string key");
    }
    const now = this.now();
    const existing = this._entries.get(key);
    const errorInfo = { message: sanitizeErrorMessage(error), code: error?.code ?? null };

    if (existing) {
      existing.error = errorInfo;
      existing.lastFailedAt = now;
      existing.payload = payload;
      this._record("push", "duplicate");
      return existing;
    }

    if (this._entries.size >= this.maxCapacity) this._evictOne();

    const entry = {
      id: randomUUID(),
      key,
      payload,
      attempts: 0,
      status: "pending",
      error: errorInfo,
      firstFailedAt: now,
      lastFailedAt: now,
      nextRetryAt: now + this._delayFor(0),
    };
    this._entries.set(key, entry);
    this._record("push", "success");
    this._publishDepth();
    this.logger.info?.({ queue: this.name, key }, "Work item dead-lettered for recovery");
    return entry;
  }

  /**
   * Attempt recovery of due, pending entries.
   *
   * @param {(entry: object) => Promise<void>} handler  Throws to signal failure
   * @param {{ maxBatch?: number }} [options]
   * @returns {Promise<{ recovered:number, failed:number, exhausted:number, skipped:boolean }>}
   */
  async recover(handler, { maxBatch = 10 } = {}) {
    const result = { recovered: 0, failed: 0, exhausted: 0, skipped: false };
    if (this._recovering) {
      result.skipped = true;
      return result;
    }
    this._recovering = true;
    try {
      const limit = clampInt(maxBatch, 10, 1, 100);
      const due = [];
      const now = this.now();
      for (const entry of this._entries.values()) {
        if (entry.status === "pending" && entry.nextRetryAt <= now) {
          due.push(entry);
          if (due.length >= limit) break;
        }
      }

      for (const entry of due) {
        try {
          await handler(entry);
          this._entries.delete(entry.key);
          this._record("recover", "success");
          result.recovered += 1;
        } catch (err) {
          entry.attempts += 1;
          entry.lastFailedAt = this.now();
          entry.error = { message: sanitizeErrorMessage(err), code: err?.code ?? null };

          if (err?.retryable === false || entry.attempts >= this.maxAttempts) {
            entry.status = "exhausted";
            this._record("exhaust", "poison_pill");
            result.exhausted += 1;
            this.logger.error?.(
              { queue: this.name, key: entry.key, attempts: entry.attempts },
              "Recovery attempts exhausted; entry isolated",
            );
          } else {
            entry.nextRetryAt = this.now() + this._delayFor(entry.attempts);
            this._record("retry", "failure");
            result.failed += 1;
          }
        }
      }
      this._publishDepth();
      return result;
    } finally {
      this._recovering = false;
    }
  }

  /** Remove everything (tests / operator reset). */
  clear() {
    this._entries.clear();
    this._record("clear", "success");
    this._publishDepth();
  }
}
