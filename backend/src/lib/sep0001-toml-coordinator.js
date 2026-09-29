/**
 * sep0001-toml-coordinator.js
 *
 * Distributed concurrency control for the SEP-0001 Stellar Info Generator
 * (issue #1460).
 *
 * Problem
 * -------
 * GET /.well-known/stellar.toml is public and unauthenticated. Every request
 * previously queried Supabase and regenerated the TOML. Wallets, anchors and
 * crawlers fetch this file aggressively, so a burst for one merchant (or a
 * cold start behind a load balancer) fans out into N identical database reads
 * across N API instances. There was also no invalidation: a cached copy could
 * not be cleared when a merchant changed the branding that feeds the file.
 *
 * Solution
 * --------
 *   1. In-process single-flight — concurrent requests for the same merchant on
 *      one instance share a single in-flight generation.
 *   2. Shared store — `sep1:{<id>}:toml` holds the rendered TOML plus a
 *      SHA-256 digest so any instance can serve a peer's result.
 *   3. Distributed lock — `sep1:{<id>}:lock` (SET NX PX + random owner token)
 *      elects one instance to regenerate. Release is a compare-and-delete Lua
 *      script, so a holder whose lease already expired can never delete a
 *      lock now owned by another instance.
 *   4. Generation fencing — `sep1:{<id>}:gen` is a counter bumped atomically
 *      with the entry delete on invalidation. The leader records the
 *      generation BEFORE reading the merchant and publishes its result with a
 *      Lua compare-and-set, so a regeneration that raced a branding update can
 *      never overwrite the fresher state with stale content.
 *   5. Followers poll the shared store. If the leader fails or crashes (lock
 *      released or expired with no entry written) the next poll takes the
 *      lock itself. After waitTimeoutMs a follower generates directly.
 *
 * All keys for one merchant share a Redis Cluster hash tag (`{<id>}`) so the
 * multi-key Lua scripts stay on a single slot.
 *
 * Failure policy: FAIL OPEN. stellar.toml is public, read-only data, so any
 * Redis failure (or the project's no-op fallback client) degrades to direct
 * generation instead of failing the request. Coordination is an optimization;
 * correctness never depends on Redis being reachable.
 *
 * Security: merchant ids are validated before they become part of a Redis
 * key, and every shared entry is validated (version, merchant binding, size,
 * digest, required SEP-0001 fields) before it is served. A corrupted or
 * tampered entry counts as a miss, never as content.
 */

import { createHash, randomUUID } from "node:crypto";
import { connectRedisClient } from "./redis.js";
import { logger } from "./logger.js";
import { generateStellarToml, validateStellarToml } from "./sep0001-generator.js";

export const ENTRY_VERSION = 1;
export const MAX_TOML_BYTES = 64 * 1024;
const KEY_PREFIX = "sep1";
const MERCHANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
// Generation counters outlive every entry and lock by a wide margin so a
// counter can never expire (and reset) while a leader still holds a lease.
const GENERATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Compare-and-delete: only the token holder may release the lock. */
export const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Publish an entry only if the generation observed before generation is still
 * current. KEYS: entry, gen. ARGV: observedGen, payload, ttlMs.
 */
export const WRITE_IF_GENERATION_SCRIPT =
  "local g = redis.call('get', KEYS[2]) or '0' " +
  "if g == ARGV[1] then redis.call('set', KEYS[1], ARGV[2], 'PX', ARGV[3]) return 1 end " +
  "return 0";

/**
 * Atomically bump the generation and drop the entry.
 * KEYS: entry, gen. ARGV: genTtlMs.
 */
export const INVALIDATE_SCRIPT =
  "local g = redis.call('incr', KEYS[2]) " +
  "redis.call('pexpire', KEYS[2], ARGV[1]) " +
  "redis.call('del', KEYS[1]) " +
  "return g";

function readIntEnv(env, name, fallback, min, max) {
  const raw = Number.parseInt(String(env[name] ?? ""), 10);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.max(raw, min), max);
}

/**
 * Resolve coordinator timing from the environment, clamped to safe bounds.
 */
export function resolveCoordinatorConfig(env = process.env) {
  return {
    cacheTtlMs: readIntEnv(env, "SEP1_TOML_CACHE_TTL_MS", 300_000, 1_000, 3_600_000),
    lockTtlMs: readIntEnv(env, "SEP1_TOML_LOCK_TTL_MS", 10_000, 1_000, 60_000),
    waitTimeoutMs: readIntEnv(env, "SEP1_TOML_LOCK_WAIT_MS", 3_000, 0, 30_000),
    pollIntervalMs: readIntEnv(env, "SEP1_TOML_LOCK_POLL_MS", 50, 10, 1_000),
  };
}

export function isValidMerchantId(merchantId) {
  return typeof merchantId === "string" && MERCHANT_ID_PATTERN.test(merchantId);
}

/**
 * Build the Redis keys for one merchant. Throws on ids that are not safe to
 * embed in a key (separators, braces, whitespace, oversized input).
 */
export function buildTomlKeys(merchantId) {
  if (!isValidMerchantId(merchantId)) {
    throw new TypeError("Invalid merchant id for SEP-0001 cache key");
  }
  const tag = `${KEY_PREFIX}:{${merchantId}}`;
  return {
    entry: `${tag}:toml`,
    gen: `${tag}:gen`,
    lock: `${tag}:lock`,
  };
}

export function digestToml(toml) {
  return createHash("sha256").update(toml, "utf8").digest("hex");
}

/**
 * Parse and validate a shared entry. Returns `{ toml, digest }` or null.
 */
export function parseSharedEntry(raw, merchantId, expectedGen) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw);
  if (text.length > MAX_TOML_BYTES * 2) return null;

  let entry;
  try {
    entry = JSON.parse(text);
  } catch {
    return null;
  }

  if (
    !entry ||
    typeof entry !== "object" ||
    entry.v !== ENTRY_VERSION ||
    entry.merchantId !== merchantId ||
    typeof entry.toml !== "string" ||
    typeof entry.digest !== "string" ||
    String(entry.gen) !== String(expectedGen) ||
    Buffer.byteLength(entry.toml, "utf8") > MAX_TOML_BYTES ||
    digestToml(entry.toml) !== entry.digest ||
    !validateStellarToml(entry.toml)
  ) {
    return null;
  }

  return { toml: entry.toml, digest: entry.digest };
}

const defaultSleep = (ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

async function resolveRedis(getRedis) {
  try {
    const client = await getRedis();
    // connectRedisClient() returns a no-op client (isOpen:false) when Redis is
    // unreachable. Its SET reports success for everyone, so treat it as "no
    // distributed backend" instead of a lock that every caller wins.
    if (!client || client.isOpen === false || typeof client.sendCommand !== "function") {
      return null;
    }
    return client;
  } catch (err) {
    logger.warn({ err: err?.message }, "SEP-0001 coordinator: Redis unavailable, generating directly");
    return null;
  }
}

/**
 * Create a coordinator bound to a merchant loader.
 *
 * @param {object} opts
 * @param {(merchantId: string) => Promise<object|null>} opts.loadMerchant
 *   Fetches the merchant row; resolves null when it does not exist.
 * @param {() => Promise<object>} [opts.getRedis]
 * @param {(merchant: object) => string} [opts.render]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {() => number} [opts.now]
 * @param {object} [opts.config]  Overrides for resolveCoordinatorConfig()
 */
export function createStellarTomlCoordinator({
  loadMerchant,
  getRedis = connectRedisClient,
  render = generateStellarToml,
  sleep = defaultSleep,
  now = Date.now,
  config = {},
} = {}) {
  if (typeof loadMerchant !== "function") {
    throw new TypeError("createStellarTomlCoordinator requires a loadMerchant function");
  }

  const settings = { ...resolveCoordinatorConfig(), ...config };
  /** merchantId -> { localGen, promise } */
  const inflight = new Map();
  /** merchantId -> local invalidation counter (orders single-flight joins) */
  const localGenerations = new Map();

  async function renderFresh(merchantId) {
    const merchant = await loadMerchant(merchantId);
    if (!merchant) return null;

    const toml = render(merchant);
    if (!validateStellarToml(toml)) {
      const err = new Error("Failed to generate valid stellar.toml");
      err.status = 500;
      throw err;
    }
    if (Buffer.byteLength(toml, "utf8") > MAX_TOML_BYTES) {
      const err = new Error("Generated stellar.toml exceeds size limit");
      err.status = 500;
      throw err;
    }
    return { toml, digest: digestToml(toml) };
  }

  async function readShared(client, keys, merchantId) {
    const [rawEntry, rawGen] = await client.sendCommand(["MGET", keys.entry, keys.gen]);
    const gen = rawGen === null || rawGen === undefined ? "0" : String(rawGen);
    if (rawEntry === null || rawEntry === undefined) {
      return { gen, hit: null };
    }
    const hit = parseSharedEntry(rawEntry, merchantId, gen);
    if (!hit) {
      logger.warn({ merchantId }, "SEP-0001 coordinator: ignoring invalid or stale shared entry");
    }
    return { gen, hit };
  }

  async function lead(client, keys, merchantId, observedGen, token) {
    try {
      const result = await renderFresh(merchantId);
      if (result) {
        const payload = JSON.stringify({
          v: ENTRY_VERSION,
          merchantId,
          gen: observedGen,
          digest: result.digest,
          toml: result.toml,
          generatedAt: now(),
        });
        try {
          const written = await client.sendCommand([
            "EVAL",
            WRITE_IF_GENERATION_SCRIPT,
            "2",
            keys.entry,
            keys.gen,
            observedGen,
            payload,
            String(settings.cacheTtlMs),
          ]);
          if (Number(written) !== 1) {
            logger.info(
              { merchantId },
              "SEP-0001 coordinator: generation changed during regeneration; result not published",
            );
          }
        } catch (err) {
          logger.warn({ err: err?.message, merchantId }, "SEP-0001 coordinator: shared write failed");
        }
      }
      return result ? { ...result, source: "leader" } : null;
    } finally {
      try {
        const released = await client.sendCommand(["EVAL", RELEASE_LOCK_SCRIPT, "1", keys.lock, token]);
        if (Number(released) !== 1) {
          logger.warn(
            { merchantId, lockTtlMs: settings.lockTtlMs },
            "SEP-0001 coordinator: lock expired before release; regeneration outlived lock TTL",
          );
        }
      } catch (err) {
        // The lease still expires via PX, so a failed release is not fatal.
        logger.error({ err: err?.message, merchantId }, "SEP-0001 coordinator: lock release failed");
      }
    }
  }

  async function coordinate(merchantId) {
    const keys = buildTomlKeys(merchantId);
    const client = await resolveRedis(getRedis);
    if (!client) {
      const result = await renderFresh(merchantId);
      return result ? { ...result, source: "direct" } : null;
    }

    const deadline = now() + settings.waitTimeoutMs;
    let leadership = null;
    try {
      for (;;) {
        const { gen, hit } = await readShared(client, keys, merchantId);
        if (hit) return { ...hit, source: "shared" };

        const token = randomUUID();
        const acquired = await client.sendCommand([
          "SET",
          keys.lock,
          token,
          "NX",
          "PX",
          String(settings.lockTtlMs),
        ]);
        if (acquired === "OK") {
          leadership = { gen, token };
          break;
        }

        if (now() >= deadline) {
          logger.warn(
            { merchantId, waitTimeoutMs: settings.waitTimeoutMs },
            "SEP-0001 coordinator: lock wait timed out, generating directly",
          );
          break;
        }
        await sleep(settings.pollIntervalMs);
      }
    } catch (err) {
      logger.warn(
        { err: err?.message, merchantId },
        "SEP-0001 coordinator: Redis coordination failed, generating directly",
      );
    }

    // Outside the try: loader/render errors from the leader must propagate,
    // not trigger a second (direct) generation.
    if (leadership) {
      return lead(client, keys, merchantId, leadership.gen, leadership.token);
    }

    const result = await renderFresh(merchantId);
    return result ? { ...result, source: "direct" } : null;
  }

  /**
   * Resolve the stellar.toml for a merchant.
   *
   * @param {string} merchantId
   * @returns {Promise<null | { toml:string, digest:string, source:"shared"|"leader"|"direct" }>}
   *   null when the merchant does not exist.
   */
  function getStellarToml(merchantId) {
    if (!isValidMerchantId(merchantId)) {
      return Promise.reject(new TypeError("Invalid merchant id"));
    }

    const localGen = localGenerations.get(merchantId) ?? 0;
    const existing = inflight.get(merchantId);
    if (existing && existing.localGen === localGen) {
      return existing.promise;
    }

    const promise = coordinate(merchantId).finally(() => {
      if (inflight.get(merchantId)?.promise === promise) {
        inflight.delete(merchantId);
      }
    });
    inflight.set(merchantId, { localGen, promise });
    return promise;
  }

  /**
   * Invalidate the cached stellar.toml for a merchant on every instance.
   * Never throws: a failed invalidation is logged and the entry ages out via
   * its TTL.
   *
   * @returns {Promise<boolean>} whether the shared store was invalidated
   */
  async function invalidate(merchantId) {
    if (!isValidMerchantId(merchantId)) return false;

    // Requests that start after this point must not join a flight that began
    // before the underlying data changed.
    localGenerations.set(merchantId, (localGenerations.get(merchantId) ?? 0) + 1);

    const client = await resolveRedis(getRedis);
    if (!client) return false;
    const keys = buildTomlKeys(merchantId);
    try {
      await client.sendCommand([
        "EVAL",
        INVALIDATE_SCRIPT,
        "2",
        keys.entry,
        keys.gen,
        String(GENERATION_TTL_MS),
      ]);
      return true;
    } catch (err) {
      logger.error({ err: err?.message, merchantId }, "SEP-0001 coordinator: invalidation failed");
      return false;
    }
  }

  return { getStellarToml, invalidate, settings };
}

let defaultCoordinator;

/**
 * Loader backed by Supabase; excludes soft-deleted merchants.
 */
export async function loadMerchantFromSupabase(merchantId) {
  const { supabase } = await import("./supabase.js");
  const { data, error } = await supabase
    .from("merchants")
    .select("id, business_name, email, notification_email, recipient, branding_config")
    .eq("id", merchantId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    const err = new Error("Failed to fetch merchant");
    err.status = 500;
    err.cause = error;
    throw err;
  }
  return data ?? null;
}

/** Process-wide coordinator used by the SEP-0001 route. */
export function getStellarTomlCoordinator() {
  if (!defaultCoordinator) {
    defaultCoordinator = createStellarTomlCoordinator({ loadMerchant: loadMerchantFromSupabase });
  }
  return defaultCoordinator;
}

/**
 * Invalidate a merchant's stellar.toml across all instances. Call after any
 * write to a field that feeds the generator (business_name, email,
 * notification_email, recipient, branding_config, deleted_at).
 */
export function invalidateStellarToml(merchantId) {
  return getStellarTomlCoordinator().invalidate(merchantId);
}

/** Test helper: drop the process-wide coordinator. */
export function resetStellarTomlCoordinatorForTests() {
  defaultCoordinator = undefined;
}
