const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_MAX_DURATION_MS = 5 * 60 * 1000;

const WEBHOOK_LOGS_TABLE = "webhook_delivery_logs";
const WEBHOOK_LOGS_TIMESTAMP_COLUMN = "timestamp";

function parsePositiveInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer value but got: ${value}`);
  }
  return parsed;
}

async function validatePurgeSafety({ pool, tableName, timestampColumn }) {
  const indexQuery = `
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = $1
      AND indexdef ILIKE '%' || $2 || '%'
    LIMIT 1
  `;
  const indexResult = await pool.query(indexQuery, [tableName, timestampColumn]);
  if (indexResult.rowCount === 0) {
    throw new Error(
      `Missing index for ${tableName}.${timestampColumn}; aborting purge to avoid sequential scans.`,
    );
  }

  const fkQuery = `
    SELECT conname
    FROM pg_constraint
    WHERE confrelid = to_regclass($1)
      AND contype = 'f'
    LIMIT 1
  `;
  const fkResult = await pool.query(fkQuery, [tableName]);
  if (fkResult.rowCount > 0) {
    throw new Error(
      `Table ${tableName} is referenced by foreign keys (example: ${fkResult.rows[0].conname}); aborting purge.`,
    );
  }
}

async function purgeWebhookLogs({
  pool,
  retentionDays = parsePositiveInteger(
    process.env.LOG_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
  ),
  batchSize = parsePositiveInteger(
    process.env.LOG_PURGE_BATCH_SIZE,
    DEFAULT_BATCH_SIZE,
  ),
  maxDurationMs = parsePositiveInteger(
    process.env.LOG_PURGE_MAX_DURATION_MS,
    DEFAULT_MAX_DURATION_MS,
  ),
} = {}) {
  if (!pool) {
    throw new Error("A pg pool/client is required for purgeWebhookLogs.");
  }

  const startedAt = Date.now();
  const tableName = WEBHOOK_LOGS_TABLE;
  const timestampColumn = WEBHOOK_LOGS_TIMESTAMP_COLUMN;

  await validatePurgeSafety({ pool, tableName, timestampColumn });

  // Compliance warning: payment audit records may require longer retention by policy/regulation.
  // Confirm this table contains operational delivery telemetry only before enforcing 30-day retention.
  let totalDeleted = 0;
  let deletedInBatch = 0;

  do {
    const deleteQuery = `
      WITH rows_to_delete AS (
        SELECT id
        FROM ${tableName}
        WHERE ${timestampColumn} < NOW() - make_interval(days => $1::int)
        ORDER BY ${timestampColumn} ASC
        LIMIT $2
      )
      DELETE FROM ${tableName} t
      USING rows_to_delete d
      WHERE t.id = d.id
      RETURNING t.id
    `;

    const deleteResult = await pool.query(deleteQuery, [retentionDays, batchSize]);
    deletedInBatch = deleteResult.rowCount ?? 0;
    totalDeleted += deletedInBatch;
  } while (deletedInBatch > 0);

  const durationMs = Date.now() - startedAt;
  const durationSec = (durationMs / 1000).toFixed(2);
  console.log(
    `[log-retention] Purge complete for ${tableName}: deleted_rows=${totalDeleted} duration_ms=${durationMs} duration_sec=${durationSec}`,
  );

  if (durationMs > maxDurationMs) {
    console.error(
      `[ALERT][log-retention] Purge exceeded max duration (${maxDurationMs}ms): actual=${durationMs}ms`,
    );
  }

  return {
    tableName,
    retentionDays,
    batchSize,
    totalDeleted,
    durationMs,
  };
}

export {
  purgeWebhookLogs,
  parsePositiveInteger,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_DURATION_MS,
};
