import "dotenv/config";
import { pool, closePool } from "../src/lib/db.js";
import { purgeWebhookLogs } from "../src/lib/log-retention.js";

async function run() {
  const startedAt = Date.now();
  try {
    const result = await purgeWebhookLogs({ pool });
    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[log-retention] Run succeeded: table=${result.tableName} deleted_rows=${result.totalDeleted} elapsed_ms=${elapsedMs}`,
    );
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    console.error(
      `[ALERT][log-retention] Run failed after ${elapsedMs}ms: ${error.message}`,
      error,
    );
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

await run();
