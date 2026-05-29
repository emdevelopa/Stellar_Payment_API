/**
 * Migration: Optimize Database Pooler Indexes
 * Issue #760: Optimize SQL queries in Database Pooler
 *
 * Adds composite indexes for the most frequently executed queries
 * in the payment service and metric service to improve query performance.
 */

export async function up(knex) {
  // Composite index for merchant payment listing (most common query)
  // Covers: WHERE merchant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_merchant_status_created
    ON payments (merchant_id, status, created_at DESC)
    WHERE deleted_at IS NULL
  `);

  // Composite index for rolling metrics query
  // Covers: WHERE merchant_id = ? AND deleted_at IS NULL AND created_at >= ?
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_merchant_created_amount
    ON payments (merchant_id, created_at DESC, amount)
    WHERE deleted_at IS NULL
  `);

  // Index for payment status lookups (used in verify-payment flow)
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_status_created
    ON payments (status, created_at DESC)
    WHERE deleted_at IS NULL
  `);

  // Index for tx_id lookups (used in payment verification)
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_tx_id
    ON payments (tx_id)
    WHERE tx_id IS NOT NULL
  `);

  // Index for audit log queries (used in audit service)
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_created_action
    ON audit_logs (created_at DESC, action)
  `);

  // Index for merchant lookups by API key (used in auth middleware)
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_api_key_active
    ON merchants (api_key_hash)
    WHERE deleted_at IS NULL
  `);
}

export async function down(knex) {
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_merchant_status_created");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_merchant_created_amount");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_status_created");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_tx_id");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_audit_logs_created_action");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_merchants_api_key_active");
}
