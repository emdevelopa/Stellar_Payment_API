import "dotenv/config";
import { createApp } from "./app.js";
import { connectRedisClient, closeRedisClient } from "./lib/redis.js";
import { closePool, pool } from "./lib/db.js";
import { validateEnvironmentVariables } from "./lib/env-validation.js";
import { logger } from "./lib/logger.js";

validateEnvironmentVariables();

const port = process.env.PORT || 4000;

async function startServer() {
  const redisClient = await connectRedisClient();

  const { app, io } = await createApp({ redisClient });

  // Probe DB
  try {
    await pool.query("SELECT 1");
    logger.info("pg pool connected");
  } catch (err) {
    logger.warn({ err }, "pg pool probe failed");
  }

  const server = app.listen(port, () => {
    logger.info({ port }, `API listening on http://localhost:${port}`);
  });

  // Attach socket.io to the HTTP server
  io.attach(server);

  function shutdown(signal) {
    logger.info({ signal }, "shutdown signal received");
    server.close(async () => {
      await closePool();
      await closeRedisClient();
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer();
