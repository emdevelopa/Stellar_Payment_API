import { createClient } from "redis";

let redisClient;
let redisErrorCount = 0;
let redisFallbackWarned = false;

function createNoopRedisClient() {
  return {
    isOpen: false,
    connect: async () => undefined,
    disconnect: () => undefined,
    close: async () => undefined,
    on: () => undefined,
    ping: async () => "PONG",
    get: async () => null,
    set: async () => "OK",
    del: async () => 0,
    hIncrBy: async () => 0,
    expire: async () => 0,
    hGetAll: async () => ({}),
    scanIterator: async function* scanIterator() {},
    sendCommand: async () => null,
  };
}

function getRedisConnectTimeoutMs(env = process.env) {
  const raw = Number.parseInt(String(env.REDIS_CONNECT_TIMEOUT_MS || "4000"), 10);
  if (!Number.isFinite(raw) || raw <= 0) return 4000;
  return raw;
}

export function getRedisClient({
  redisUrl = process.env.REDIS_URL,
  clientFactory = createClient,
} = {}) {
  if (!redisClient) {
    redisClient = clientFactory({
      url: redisUrl,
      socket: {
        connectTimeout: getRedisConnectTimeoutMs(),
        // Prevent endless reconnect loops when Redis URL is invalid/unreachable.
        reconnectStrategy: () => false,
      },
    });
    redisClient.on("error", (err) => {
      redisErrorCount += 1;
      const suffix = err?.message ? ` ${err.message}` : "";
      if (redisErrorCount <= 3) {
        console.error("Redis client error:" + suffix);
      } else if (redisErrorCount === 4) {
        console.error("Redis client error: suppressing repeated logs");
      }
    });
  }
  return redisClient;
}

export async function connectRedisClient(options) {
  const client = getRedisClient(options);
  if (!client.isOpen) {
    const timeoutMs = getRedisConnectTimeoutMs();
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Redis connection timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      await Promise.race([client.connect(), timeout]);
    } catch (err) {
      try {
        client.disconnect();
      } catch {}
      if (!redisFallbackWarned) {
        const suffix = err?.message ? ` (${err.message})` : "";
        console.warn(`Redis unavailable, using no-op fallback${suffix}`);
        redisFallbackWarned = true;
      }
      return createNoopRedisClient();
    }
  }
  return client;
}

export async function closeRedisClient() {
  if (!redisClient) {
    return;
  }
  if (redisClient.isOpen) {
    await redisClient.close();
  }
}

export function resetRedisClientForTests() {
  redisClient = undefined;
}

// ---------------------------------------------------------------------------
// Payment status cache helpers
// ---------------------------------------------------------------------------

/** TTL in seconds for payment-status cache entries. */
export const PAYMENT_STATUS_TTL = 2;

/** Consistent cache key for a payment-status entry. */
export function paymentCacheKey(id) {
  return `payment:status:${id}`;
}

/**
 * Return the cached payment object, or null on miss / Redis unavailable.
 * @param {import("redis").RedisClientType} client
 * @param {string} id  payment UUID
 */
export async function getCachedPayment(client, id) {
  try {
    const raw = await client.get(paymentCacheKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    // Never let a cache failure block the request
    console.error("Redis GET error:", err.message);
    return null;
  }
}

/**
 * Store a payment object in the cache with a ~2 s TTL.
 * @param {import("redis").RedisClientType} client
 * @param {string} id  payment UUID
 * @param {object} data  the payment row to cache
 */
export async function setCachedPayment(client, id, data) {
  try {
    await client.set(paymentCacheKey(id), JSON.stringify(data), {
      EX: PAYMENT_STATUS_TTL,
    });
  } catch (err) {
    console.error("Redis SET error:", err.message);
  }
}

/**
 * Invalidate the cache entry for a payment (call after any write).
 * @param {import("redis").RedisClientType} client
 * @param {string} id  payment UUID
 */
export async function invalidatePaymentCache(client, id) {
  try {
    await client.del(paymentCacheKey(id));
  } catch (err) {
    console.error("Redis DEL error:", err.message);
  }
}
