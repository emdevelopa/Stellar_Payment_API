/**
 * Enhanced database module with query performance monitoring and observability
 * Issue: SQL Query Performance Optimization for Transaction Signer
 * 
 * This module extends the base db.js with:
 * - Query timing metrics (Prometheus)
 * - Structured logging with query context
 * - Retry count tracking
 * - Slow query detection and alerting
 * - Connection pool health monitoring with alerts
 */

import pg from 'pg';
import { logger } from './logger.js';
import {
  pgPoolTotalConnections,
  pgPoolIdleConnections,
  pgPoolWaitingRequests,
  pgPoolUtilizationPercent,
  queryDuration,
  queryRetryCount,
  slowQueryCount,
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
const SLOW_QUERY_THRESHOLD_MS = Number.parseInt(
  process.env.SLOW_QUERY_THRESHOLD_MS || '1000',
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
  logger.error({ err: err.message }, 'pg pool unexpected error');
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

/**
 * Enhanced query execution with retry logic, performance monitoring, and structured logging.
 * 
 * @param {string} text - SQL query string
 * @param {Array} values - Query parameters
 * @param {Object} options - Configuration options
 * @param {string} options.label - Query label for metrics and logging
 * @param {number} options.retryAttempts - Maximum retry attempts (default: 2)
 * @param {number} options.retryDelayMs - Initial retry delay in ms (default: 150)
 * @returns {Promise<Object>} Query result
 */
export async function queryWithRetry(
  text,
  values = [],
  {
    label = 'query',
    retryAttempts = DEFAULT_RETRY_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  } = {},
) {
  const startTime = Date.now();
  let lastError;
  let retryCount = 0;

  for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
    try {
      const result = await pool.query(text, values);
      const duration = Date.now() - startTime;

      // Record metrics
      queryDuration.observe({ label }, duration);
      if (retryCount > 0) {
        queryRetryCount.inc({ label }, retryCount);
      }

      // Detect slow queries
      if (duration > SLOW_QUERY_THRESHOLD_MS) {
        slowQueryCount.inc({ label, threshold: SLOW_QUERY_THRESHOLD_MS });
        logger.warn({
          label,
          duration,
          threshold: SLOW_QUERY_THRESHOLD_MS,
          retryCount,
          rowCount: result.rowCount,
          queryLength: text.length,
        }, 'Slow query detected');
      } else {
        // Structured logging for normal queries
        logger.debug({
          label,
          duration,
          retryCount,
          rowCount: result.rowCount,
        }, 'Query executed successfully');
      }

      return result;
    } catch (err) {
      lastError = err;
      retryCount = attempt + 1;
      const shouldRetry = attempt < retryAttempts && isRetryablePoolError(err);

      if (!shouldRetry) {
        // Log final failure with context
        const duration = Date.now() - startTime;
        logger.error({
          label,
          duration,
          retryCount,
          errorCode: err.code,
          errorMessage: err.message,
        }, 'Query failed after retries');
        throw err;
      }

      const delayMs = getBackoffDelay(attempt, retryDelayMs);
      logger.warn({
        label,
        attempt: attempt + 1,
        totalAttempts: retryAttempts + 1,
        delayMs,
        errorCode: err.code,
        errorMessage: err.message,
      }, 'pg pool query failed, retrying');
      await sleep(delayMs);
    }
  }

  // This should not be reached, but handle it
  const duration = Date.now() - startTime;
  logger.error({
    label,
    duration,
    retryCount,
    errorMessage: lastError?.message,
  }, 'Query failed unexpectedly');
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
 * Enhanced pool monitoring with health checks and alerts.
 * Call this during application startup to enable periodic monitoring.
 * 
 * @param {number} intervalMs - Monitoring interval in milliseconds (default: 60_000)
 * @returns {Function} Cleanup function to stop monitoring
 */
export function startPoolMonitoring(intervalMs = 60_000) {
  const interval = setInterval(() => {
    const stats = getPoolStats();
    const utilizationPercent = (
      (stats.totalConnections - stats.idleConnections) / stats.maxConnections * 100
    ).toFixed(2);

    logger.info({
      timestamp: new Date().toISOString(),
      ...stats,
      utilizationPercent,
    }, 'Pool stats');
    
    // Alert if utilization is high (>80%)
    if (parseFloat(utilizationPercent) > 80) {
      logger.warn({
        utilizationPercent,
        totalConnections: stats.totalConnections,
        idleConnections: stats.idleIdleCount,
        waitingRequests: stats.waitingCount,
      }, 'High connection pool utilization detected');
    }
    
    // Alert if many clients are waiting
    if (stats.waitingCount > 5) {
      logger.warn({
        waitingRequests: stats.waitingCount,
        totalConnections: stats.totalConnections,
      }, 'Many clients waiting for database connections');
    }
    
    // Update Prometheus metrics
    updatePoolMetrics();
  }, intervalMs);

  return () => clearInterval(interval);
}

/**
 * Analyze slow queries from pg_stat_statements (if available).
 * This requires pg_stat_statements extension to be enabled in PostgreSQL.
 * 
 * @returns {Promise<Array>} Array of slow query statistics
 */
export async function analyzeSlowQueries(limit = 10) {
  try {
    const query = `
      SELECT 
        query,
        calls,
        total_time,
        mean_time,
        stddev_time,
        max_time
      FROM pg_stat_statements
      WHERE query NOT LIKE '%pg_stat_statements%'
      ORDER BY mean_time DESC
      LIMIT $1
    `;
    const result = await queryWithRetry(query, [limit], {
      label: 'slow-query-analysis',
    });
    
    logger.info({
      slowQueries: result.rows,
      count: result.rows.length,
    }, 'Slow query analysis completed');
    
    return result.rows;
  } catch (err) {
    logger.warn({
      err: err.message,
    }, 'pg_stat_statements not available or query failed');
    return [];
  }
}

/**
 * Get index usage statistics to identify unused or inefficient indexes.
 * 
 * @returns {Promise<Array>} Array of index usage statistics
 */
export async function analyzeIndexUsage() {
  try {
    const query = `
      SELECT 
        schemaname,
        tablename,
        indexname,
        idx_scan as index_scans,
        idx_tup_read as tuples_read,
        idx_tup_fetch as tuples_fetched,
        pg_size_pretty(pg_relation_size(indexrelid)) as index_size
      FROM pg_stat_user_indexes
      ORDER BY idx_scan ASC
    `;
    const result = await queryWithRetry(query, [], {
      label: 'index-usage-analysis',
    });
    
    logger.info({
      indexStats: result.rows,
      count: result.rows.length,
    }, 'Index usage analysis completed');
    
    return result.rows;
  } catch (err) {
    logger.error({
      err: err.message,
    }, 'Index usage analysis failed');
    return [];
  }
}

/**
 * Closes all pool connections gracefully.
 * Call this on SIGTERM / SIGINT to allow in-flight queries to finish.
 */
export async function closePool() {
  logger.info('Closing database connection pool...');
  await pool.end();
  logger.info('Database connection pool closed');
}

export { pool };
