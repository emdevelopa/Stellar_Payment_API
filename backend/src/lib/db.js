import pg from 'pg';
import {
  pgPoolTotalConnections,
  pgPoolIdleConnections,
  pgPoolWaitingRequests,
  pgPoolUtilizationPercent,
} from './metrics.js';

const { Pool } = pg;
const DEFAULT_RETRY_ATTEMPTS = Number.parseInt(
  process.env.DB_POOL_RETRY_ATTEMPTS || '2',
  10,
);
const DEFAULT_RETRY_DELAY_MS = Number.parseInt(
  process.env.DB_POOL_RETRY_DELAY_MS || '150',
  10,
);
const RETRYABLE_PG_CODES = new Set([
  '08000',
  '08003',
  '08006',
  '08P01',
  '40001',
  '40P01',
  '53300',
  '57P01',
  '57P02',
  '57P03',
]);
const RETRYABLE_ERROR_PATTERNS = [
  /connection terminated/i,
  /connection ended unexpectedly/i,
  /connection timeout/i,
  /timeout exceeded/i,
  /too many clients/i,
  /server closed the connection unexpectedly/i,
  /terminating connection due to administrator command/i,
];

/**
 * Singleton pg.Pool connecting through Supabase's Transaction Pooler (port 6543).
 *
 * Connection limits:
 *  - max: 20  — optimized for concurrent traffic while staying below Supabase free-tier's 60-connection cap
 *  - min: 2   — maintain minimum connections for faster response times
 *  - idleTimeoutMillis: 30 000  — release idle clients after 30 s
 *  - connectionTimeoutMillis: 5 000  — fail fast instead of queuing indefinitely
 *  - statement_timeout: 30 000  — prevent long-running queries from blocking the pool
 *
 * DATABASE_URL must point to the pooler endpoint, e.g.:
 *   postgresql://postgres.xxxx:<password>@aws-0-us-east-1.pooler.supabase.com:6543/postgres
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  min: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
  ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('pg pool unexpected error:', err.message);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryablePoolError(err) {
  if (!err) {
    return false;
  }

  if (typeof err.code === 'string' && RETRYABLE_PG_CODES.has(err.code)) {
    return true;
  }

  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(String(err.message || '')));
}

function getBackoffDelay(attempt, baseDelayMs) {
  return baseDelayMs * (attempt + 1);
}

export async function queryWithRetry(
  text,
  values = [],
  {
    label = 'query',
    retryAttempts = DEFAULT_RETRY_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  } = {},
) {
  let lastError;

  for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
    try {
      return await pool.query(text, values);
    } catch (err) {
      lastError = err;
      const shouldRetry = attempt < retryAttempts && isRetryablePoolError(err);

      if (!shouldRetry) {
        throw err;
      }

      const delayMs = getBackoffDelay(attempt, retryDelayMs);
      console.warn(
        `pg pool ${label} failed (attempt ${attempt + 1}/${retryAttempts + 1}): ${err.message}. Retrying in ${delayMs}ms.`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Get current pool statistics for monitoring.
 * Useful for tracking connection pool health and performance.
 */
export function getPoolStats() {
  return {
    totalConnections: pool.totalCount,
    idleConnections: pool.idleCount,
    waitingRequests: pool.waitingCount,
    maxConnections: pool.options.max,
    minConnections: pool.options.min,
  };
}

/**
 * Update Prometheus metrics with current pool statistics.
 */
function updatePoolMetrics() {
  const stats = getPoolStats();
  pgPoolTotalConnections.set(stats.totalConnections);
  pgPoolIdleConnections.set(stats.idleConnections);
  pgPoolWaitingRequests.set(stats.waitingRequests);
  
  const utilizationPercent = (
    (stats.totalConnections - stats.idleConnections) / stats.maxConnections * 100
  );
  pgPoolUtilizationPercent.set(parseFloat(utilizationPercent.toFixed(2)));
}

/**
 * Log pool statistics at regular intervals for monitoring.
 * Call this during application startup to enable periodic logging.
 */
export function startPoolMonitoring(intervalMs = 60_000) {
  const interval = setInterval(() => {
    const stats = getPoolStats();
    console.log('Pool stats:', {
      timestamp: new Date().toISOString(),
      ...stats,
      utilizationPercent: ((stats.totalConnections - stats.idleConnections) / stats.maxConnections * 100).toFixed(2),
    });
    
    // Update Prometheus metrics
    updatePoolMetrics();
  }, intervalMs);

  return () => clearInterval(interval);
}

/**
 * Closes all pool connections gracefully.
 * Call this on SIGTERM / SIGINT to allow in-flight queries to finish.
 */
export async function closePool() {
  await pool.end();
}

export { pool };
