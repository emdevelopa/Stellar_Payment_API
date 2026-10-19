import { createHash, randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import {
  paymentProcessorLockAcquisitions,
  paymentProcessorLockWaitDuration,
} from "./payment-processor-metrics.js";

const RELEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const RENEW_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const PAYMENT_PROCESSOR_LOCK_OPTIONS = Object.freeze({
  ttlMs: positiveInt(process.env.PAYMENT_PROCESSOR_LOCK_TTL_MS, 30_000),
  waitMs: positiveInt(process.env.PAYMENT_PROCESSOR_LOCK_WAIT_MS, 2_000),
  retryMs: positiveInt(process.env.PAYMENT_PROCESSOR_LOCK_RETRY_MS, 50),
});

const localLocks = new Set();
const sleep = (ms) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  timer.unref?.();
});

/** Hash untrusted identifiers so lock keys cannot inject Redis namespaces. */
export function paymentProcessorLockKey(operation, resourceId) {
  const digest = createHash("sha256")
    .update(`${operation}\0${resourceId}`)
    .digest("hex");
  return `lock:payment-processor:${operation}:${digest}`;
}

function lockUnavailableError(operation) {
  const error = new Error(`Payment ${operation} is already in progress`);
  error.status = 409;
  error.code = "PAYMENT_PROCESSOR_LOCKED";
  return error;
}

function coordinationUnavailableError() {
  const error = new Error("Payment processor coordination is temporarily unavailable");
  error.status = 503;
  error.code = "PAYMENT_PROCESSOR_COORDINATION_UNAVAILABLE";
  return error;
}

async function acquireLocal(key, deadline, retryMs) {
  while (Date.now() <= deadline) {
    if (!localLocks.has(key)) {
      localLocks.add(key);
      return true;
    }
    await sleep(retryMs);
  }
  return false;
}

/**
 * Execute a payment state transition under a per-resource lease.
 *
 * Redis uses SET NX PX, a random owner token, owner-checked renewal and
 * owner-checked release. A process-local lock preserves same-instance safety
 * when Redis is not configured; callers still retain their database-level
 * conditional writes as the final consistency boundary.
 */
export async function withPaymentProcessorLock(
  operation,
  resourceId,
  callback,
  { redisClient, ...overrides } = {},
) {
  if (typeof callback !== "function") throw new TypeError("callback must be a function");
  if (!operation || !resourceId) throw new TypeError("operation and resourceId are required");

  const options = { ...PAYMENT_PROCESSOR_LOCK_OPTIONS, ...overrides };
  const key = paymentProcessorLockKey(operation, resourceId);
  const token = randomUUID();
  const startedAt = Date.now();
  const deadline = startedAt + options.waitMs;
  const distributed = redisClient?.isOpen !== false &&
    typeof redisClient?.sendCommand === "function";
  let acquired = false;
  let renewTimer;

  try {
    if (!distributed && options.requireDistributed) {
      paymentProcessorLockAcquisitions.inc({ operation, outcome: "error" });
      throw coordinationUnavailableError();
    }
    if (distributed) {
      while (Date.now() <= deadline) {
        const reply = await redisClient.sendCommand([
          "SET", key, token, "PX", String(options.ttlMs), "NX",
        ]);
        if (reply === "OK") {
          acquired = true;
          break;
        }
        await sleep(options.retryMs);
      }
    } else {
      acquired = await acquireLocal(key, deadline, options.retryMs);
    }

    const outcome = acquired ? "acquired" : "contended";
    paymentProcessorLockAcquisitions.inc({ operation, outcome });
    paymentProcessorLockWaitDuration.observe(
      { operation, outcome },
      (Date.now() - startedAt) / 1000,
    );
    if (!acquired) throw lockUnavailableError(operation);

    if (distributed) {
      renewTimer = setInterval(async () => {
        try {
          const renewed = await redisClient.sendCommand([
            "EVAL", RENEW_SCRIPT, "1", key, token, String(options.ttlMs),
          ]);
          if (Number(renewed) !== 1) {
            clearInterval(renewTimer);
            logger.warn({ operation }, "Payment processor lock lease was lost");
          }
        } catch (err) {
          clearInterval(renewTimer);
          logger.error({ err, operation }, "Payment processor lock renewal failed");
        }
      }, Math.max(10, Math.floor(options.ttlMs / 3)));
      renewTimer.unref?.();
    }

    return await callback();
  } catch (err) {
    if (
      !acquired &&
      distributed &&
      !["PAYMENT_PROCESSOR_LOCKED", "PAYMENT_PROCESSOR_COORDINATION_UNAVAILABLE"].includes(err?.code)
    ) {
      paymentProcessorLockAcquisitions.inc({ operation, outcome: "error" });
      logger.error({ err, operation }, "Payment processor distributed lock failed");
    }
    throw err;
  } finally {
    if (renewTimer) clearInterval(renewTimer);
    if (acquired) {
      if (distributed) {
        try {
          await redisClient.sendCommand(["EVAL", RELEASE_SCRIPT, "1", key, token]);
        } catch (err) {
          logger.error({ err, operation }, "Payment processor lock release failed");
        }
      } else {
        localLocks.delete(key);
      }
    }
  }
}

export { RELEASE_SCRIPT, RENEW_SCRIPT };
