import "dotenv/config";
import { createApp } from "./app.js";
import { connectRedisClient, closeRedisClient } from "./lib/redis.js";
import { closePool, pool } from "./lib/db.js";
import { validateEnvironmentVariables } from "./lib/env-validation.js";

validateEnvironmentVariables();

const port = process.env.PORT || 4000;

async function startServer() {
  const redisClient = await connectRedisClient();

  const app = await createApp({ redisClient });

  // Probe DB
  try {
    await pool.query("SELECT 1");
    console.log("✅ pg pool connected");
  } catch (err) {
    console.warn("⚠️ pg pool probe failed:", err.message);
  }

  const server = app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });

  function shutdown(signal) {
    console.log(`${signal} received — shutting down...`);
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