import "dotenv/config";
import { initSentry } from "./lib/sentry.js";
import { createApp } from "./app.js";
import { connectRedisClient, closeRedisClient } from "./lib/redis.js";
import { closePool, pool, startPoolMonitoring } from "./lib/db.js";
import { validateEnvironmentVariables } from "./lib/env-validation.js";
import { logger } from "./lib/logger.js";
import { isHorizonReachable } from "./lib/stellar.js";
import cron from "node-cron";
import { archiveOldPaymentIntents } from "./lib/maintenance.js";
import { startHorizonPoller, stopHorizonPoller } from "./lib/horizon-poller.js";

initSentry();
validateEnvironmentVariables();

const port = process.env.PORT || 4000;
const host = process.env.HOST || "0.0.0.0";

async function startServer() {
  let redisClient = null;
  try {
    redisClient = await connectRedisClient();
    if (redisClient?.isOpen) {
      logger.info("redis connected");
    } else {
      logger.warn("redis unavailable, continuing with in-memory fallbacks");
    }
  } catch (err) {
    logger.warn({ err }, "redis unavailable, continuing with in-memory fallbacks");
  }

  const { app, io } = await createApp({ redisClient });

  if (process.env.NODE_ENV !== "production") {
    const probe = async (name, fn) => {
      const start = Date.now();
      try {
        const result = await fn();
        if (result === false) throw new Error("Unreachable");
        return { Service: name, Status: "OK", "Latency (ms)": Date.now() - start };
      } catch (err) {
        return { Service: name, Status: "FAILED", "Latency (ms)": "N/A" };
      }
    };

    const results = await Promise.allSettled([
      probe("Database", () => pool.query("SELECT 1")),
      probe("Redis", () => (redisClient ? redisClient.ping() : Promise.reject(new Error("redis unavailable")))),
      probe("Horizon", () => isHorizonReachable())
    ]);

    console.log("\n--- Startup Dependency Probes ---");
    console.table(results.map((r) => r.value));
    console.log("---------------------------------\n");
  } else {
    // Probe DB in production normally
    try {
      await pool.query("SELECT 1");
      logger.info("pg pool connected");
    } catch (err) {
      logger.warn({ err }, "pg pool probe failed");
    }
  }

  // Start pool monitoring if enabled
  let stopPoolMonitoring;
  if (process.env.POOL_MONITORING_ENABLED === "true") {
    const monitoringIntervalMs = parseInt(process.env.POOL_MONITORING_INTERVAL_MS || "60000", 10);
    stopPoolMonitoring = startPoolMonitoring(monitoringIntervalMs);
    logger.info({ intervalMs: monitoringIntervalMs }, "pool monitoring started");
  }

  const server = app.listen(port, host, () => {
    logger.info({ host, port }, `API listening on http://${host}:${port}`);
  });

  // Attach socket.io to the HTTP server
  io.attach(server);

  // Start Horizon poller — auto-confirms pending payments
  startHorizonPoller(io);

  // Schedule maintenance jobs: Run once daily at 2:00 AM
  const maintenanceJob = cron.schedule("0 2 * * *", () => {
    logger.info("Starting daily archival of old payment intents");
    archiveOldPaymentIntents().catch(err => {
      logger.error({ err }, "Daily archival failed");
    });
  });

  function shutdown(signal) {
    logger.info({ signal }, "shutdown signal received");
    if (stopPoolMonitoring) stopPoolMonitoring();
    stopHorizonPoller();
    maintenanceJob.stop();
    server.close(async () => {
      await closePool();
      await closeRedisClient();
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "UNCAUGHT_EXCEPTION: process crashing");
    // Allow logger to flush before exiting
    setTimeout(() => process.exit(1), 1000);
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error({ reason, promise }, "UNHANDLED_REJECTION: a promise was rejected but not caught");
  });
}

startServer();
