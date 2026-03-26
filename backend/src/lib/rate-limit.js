import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";

export const RATE_LIMIT_REDIS_PREFIX = "rl:";

export function createRedisRateLimitStore({
  client,
  StoreClass = RedisStore,
  prefix = RATE_LIMIT_REDIS_PREFIX,
} = {}) {
  return new StoreClass({
    sendCommand: (...args) => client.sendCommand(args),
    prefix,
  });
}

export function createVerifyPaymentRateLimit({
  store,
  rateLimitFactory = rateLimit,
} = {}) {
  return rateLimitFactory({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: "Too many verification requests, please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
    store,
  });
}
