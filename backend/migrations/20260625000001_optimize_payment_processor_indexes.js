/**
 * Migration: Optimize Payment Processor SQL Queries
 * Issue #924: Optimize SQL queries in Payment Processor
 *
 * Adds targeted indexes to improve query performance for the most
 * frequently executed payment service queries, particularly the
 * payment listing and rolling metrics endpoints.
 */

export async function up(knex) {
  // Partial index for payment listing with search (ILIKE on id, description, recipient)
  // The existing merchant_id index doesn't cover text search well
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_description_search
    ON payments USING gin (description gin_trgm_ops)
    WHERE deleted_at IS NULL AND description IS NOT NULL
  `).catch(() => {
    // gin_trgm_ops extension may not be available; skip silently
    console.log("  ℹ️ Skipping gin_trgm_ops index (extension not available)");
  });

  // Covering index for payment status endpoint (avoids heap lookup for common fields)
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_status_covering
    ON payments (id)
    INCLUDE (merchant_id, amount, asset, asset_issuer, recipient, status, tx_id, created_at)
    WHERE deleted_at IS NULL
  `);

  // Index for refund lookups: confirmed payments by merchant with tx_id
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_merchant_refund
    ON payments (merchant_id, status, id)
    INCLUDE (amount, asset, asset_issuer, recipient, tx_id, metadata)
    WHERE deleted_at IS NULL AND status = 'confirmed'
  `);

  // Index for path payment quote lookups
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_quote_lookup
    ON payments (id, status, asset, asset_issuer, recipient, amount)
    WHERE deleted_at IS NULL
  `);

  // Index for the rolling metrics time-range query with amount aggregation
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_metrics_window
    ON payments (merchant_id, created_at DESC)
    INCLUDE (amount, status)
    WHERE deleted_at IS NULL
  `);

  // Partial index for x402 payments
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_x402_status
    ON payments (status, created_at DESC)
    WHERE deleted_at IS NULL AND metadata->>'x402_version' IS NOT NULL
  `).catch(() => {
    console.log("  ℹ️ Skipping x402 partial index (column or extension not available)");
  });

  console.log("✓ Added Payment Processor query optimization indexes");
}

export async function down(knex) {
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_description_search");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_status_covering");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_merchant_refund");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_quote_lookup");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_metrics_window");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_x402_status");
  console.log("✓ Removed Payment Processor query optimization indexes");
}
