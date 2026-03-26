import { createClient } from "redis";

let redisClient;

export function getRedisClient({
  redisUrl = process.env.REDIS_URL,
  clientFactory = createClient,
} = {}) {
  if (!redisClient) {
    redisClient = clientFactory({ url: redisUrl });
    redisClient.on("error", (err) => {
      console.error("Redis client error:", err.message);
    });
  }

  return redisClient;
}

export async function connectRedisClient(options) {
  const client = getRedisClient(options);

  if (!client.isOpen) {
    await client.connect();
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
