import crypto from "node:crypto";
import { getRedisClient } from "./redis.js";
import { logger } from "./logger.js";
import {
  idempotencyRequestsTotal,
  idempotencyLockDuration,
  idempotencyOrphanedCompletionsTotal,
} from "./metrics.js";

/**
 * TTL for completed idempotency records in seconds.
 */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * TTL for the in-flight lock a request holds while its handler is running.
 *
 * This bounds the worst-case stall: if a worker dies between acquiring the lock
 * and writing the completion record, the lock self-heals after this window so a
 * retry can make progress instead of being rejected forever.
 */
export const IDEMPOTENCY_LOCK_TTL_MS = (() => {
  const raw = Number.parseInt(String(process.env.IDEMPOTENCY_LOCK_TTL_MS ?? ""), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
})();

/**
 * Atomically replaces an in-flight record with its completion, but only while
 * the caller still owns the lock (token match). Returns 1 on success, 0 when the
 * lock was lost (expired and/or re-acquired by another request) so the caller
 * can avoid clobbering the new owner's state.
 */
export const COMPLETE_LOCK_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, data = pcall(cjson.decode, raw)
if not ok or type(data) ~= 'table' or data.token ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', tonumber(ARGV[3]))
return 1
`;

/**
 * Atomically deletes an in-flight record only if the caller still owns the lock
 * (token match). Used when a handler fails or aborts so a retry is not blocked.
 */
export const RELEASE_LOCK_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, data = pcall(cjson.decode, raw)
if not ok or type(data) ~= 'table' or data.token ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;

/**
 * Deterministic hash of the request body. Kept as a plain JSON.stringify hash so
 * records written before this change (which used the same input) still match.
 */
export function hashPayload(body) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(body ?? {}))
    .digest("hex");
}

export function buildIdempotencyKey(merchantId, idempotencyKey) {
  return `idempotency:${merchantId}:${idempotencyKey}`;
}

/**
 * Normalises a raw Redis value into a record with an explicit state.
 * Legacy records ({ hash, response } only) are treated as completed replays.
 */
function parseRecord(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  if (data.state === "inflight" || data.state === "completed") return data;
  if (data.response !== undefined) {
    return { state: "completed", hash: data.hash, statusCode: 201, response: data.response };
  }
  return null;
}

async function acquireLock(client, key, value, ttlMs) {
  const result = await client.set(key, value, { NX: true, PX: ttlMs });
  return result === "OK" || result === true;
}

async function compareAndSwap(client, key, token, value, ttlMs) {
  if (typeof client.eval === "function") {
    const result = await client.eval(COMPLETE_LOCK_SCRIPT, {
      keys: [key],
      arguments: [token, value, String(ttlMs)],
    });
    return Number(result) === 1;
  }
  // Fallback for clients without scripting (e.g. the no-op Redis shim).
  const current = parseRecord(await client.get(key));
  if (!current || current.token !== token) return false;
  await client.set(key, value, { PX: ttlMs });
  return true;
}

async function releaseLock(client, key, token) {
  if (typeof client.eval === "function") {
    const result = await client.eval(RELEASE_LOCK_SCRIPT, {
      keys: [key],
      arguments: [token],
    });
    return Number(result) === 1;
  }
  const current = parseRecord(await client.get(key));
  if (!current || current.token !== token) return false;
  await client.del(key);
  return true;
}

function replay(res, record) {
  const statusCode = Number.isInteger(record.statusCode) ? record.statusCode : 201;
  res.set("Idempotency-Replayed", "true");
  res.status(statusCode).json(record.response);
}

/**
 * Handles an existing record that was found for the key.
 * Returns true when the request has been answered, false when the caller
 * observed an in-flight conflict (also answered) — never "continue".
 */
function resolveExisting(res, record, payloadHash) {
  if (record.hash && record.hash !== payloadHash) {
    idempotencyRequestsTotal.inc({ result: "payload_mismatch" });
    res.status(400).json({
      error: "Idempotency-Key already used with a different request payload",
    });
    return;
  }
  if (record.state === "inflight") {
    idempotencyRequestsTotal.inc({ result: "in_flight_conflict" });
    res.set("Retry-After", "1");
    res.status(409).json({
      error: "A request with this Idempotency-Key is already in progress",
    });
    return;
  }
  idempotencyRequestsTotal.inc({ result: "replay" });
  replay(res, record);
}

/**
 * Builds the idempotency middleware.
 *
 * Distributed concurrency control: a request claims the key with an atomic
 * `SET NX PX`, so only one instance processes a given key at a time. Concurrent
 * duplicates receive 409 while the original is in flight, a completed record is
 * replayed verbatim, and a lock that outlives its owner self-heals via TTL.
 */
export function createIdempotencyMiddleware({
  getClient = getRedisClient,
  lockTtlMs = IDEMPOTENCY_LOCK_TTL_MS,
  ttlSeconds = IDEMPOTENCY_TTL_SECONDS,
} = {}) {
  return async function idempotencyMiddleware(req, res, next) {
    if (req.method !== "POST") {
      idempotencyRequestsTotal.inc({ result: "bypassed" });
      return next();
    }

    const idempotencyKey = req.get("Idempotency-Key");

    if (idempotencyKey === undefined) {
      idempotencyRequestsTotal.inc({ result: "bypassed" });
      return next();
    }

    if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
      return res.status(400).json({
        error: "Idempotency-Key header must be a non-empty string",
      });
    }

    const merchantId = req.merchant?.id;
    if (!merchantId) {
      return res.status(401).json({ error: "Merchant authentication required" });
    }

    const redisKey = buildIdempotencyKey(merchantId, idempotencyKey);
    const payloadHash = hashPayload(req.body);

    let client;
    let lockAcquired = false;
    let token;
    let settled = false;
    let lockStartedAt = 0;

    const observeLock = (outcome) => {
      if (lockAcquired && lockStartedAt) {
        idempotencyLockDuration.observe({ outcome }, (Date.now() - lockStartedAt) / 1000);
      }
    };

    try {
      client = getClient();

      const existingRaw = await client.get(redisKey);
      if (existingRaw) {
        const record = parseRecord(existingRaw);
        if (!record) {
          await client.del(redisKey);
        } else {
          return resolveExisting(res, record, payloadHash);
        }
      }

      token = crypto.randomUUID();
      const inflight = JSON.stringify({
        state: "inflight",
        hash: payloadHash,
        token,
        startedAt: new Date().toISOString(),
      });

      lockAcquired = await acquireLock(client, redisKey, inflight, lockTtlMs);

      if (!lockAcquired) {
        // Lost the race between GET and SET — resolve against the winner's record.
        const winnerRaw = await client.get(redisKey);
        const winner = winnerRaw ? parseRecord(winnerRaw) : null;
        if (winner) {
          return resolveExisting(res, winner, payloadHash);
        }
        // The winner vanished (expired/rolled back); treat as best-effort proceed.
        return next();
      }

      lockStartedAt = Date.now();
      idempotencyRequestsTotal.inc({ result: "acquired" });

      const originalJson = res.json.bind(res);

      res.json = function idempotentJson(data) {
        if (!settled) {
          settled = true;
          const statusCode = res.statusCode;

          if (statusCode >= 200 && statusCode < 300) {
            const completed = JSON.stringify({
              state: "completed",
              hash: payloadHash,
              statusCode,
              response: data,
            });
            compareAndSwap(client, redisKey, token, completed, ttlSeconds * 1000)
              .then((completedWritten) => {
                observeLock(completedWritten ? "completed" : "orphaned");
                if (!completedWritten) {
                  idempotencyOrphanedCompletionsTotal.inc();
                  logger.warn(
                    { idempotencyKey, merchantId },
                    "Idempotency lock lost before response was cached; response replayed only if retried after completion",
                  );
                }
              })
              .catch((err) => {
                observeLock("orphaned");
                logger.error(
                  { err, idempotencyKey, merchantId },
                  "Failed to persist idempotency completion record",
                );
              });
          } else {
            releaseLock(client, redisKey, token)
              .then(() => observeLock("released"))
              .catch((err) => {
                logger.error(
                  { err, idempotencyKey, merchantId },
                  "Failed to release idempotency lock after non-2xx response",
                );
              });
          }
        }
        return originalJson(data);
      };

      res.on("close", () => {
        if (!settled) {
          settled = true;
          releaseLock(client, redisKey, token)
            .then(() => observeLock("released"))
            .catch((err) => {
              logger.error(
                { err, idempotencyKey, merchantId },
                "Failed to release idempotency lock for aborted request",
              );
            });
        }
      });

      return next();
    } catch (err) {
      // Fail open: a Redis outage must not take down payment creation.
      idempotencyRequestsTotal.inc({ result: "redis_error" });
      logger.error(
        { err, idempotencyKey, merchantId },
        "Idempotency check failed (Redis error); proceeding without idempotency guarantee",
      );
      return next();
    }
  };
}

export const idempotencyMiddleware = createIdempotencyMiddleware();
