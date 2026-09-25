/**
 * Migration: Optimize Path Payment Service SQL Queries
 * Issue #884: Optimize SQL queries in Path Payment Service
 *
 * Adds targeted composite and partial indexes for the most expensive
 * Path Payment Service queries: filtered payment listing with pagination,
 * asset-based filtering, client_id scoping, and rolling metrics aggregation.
 * All indexes use CONCURRENTLY to avoid locking production tables.
 */

export async function up(knex) {
  // Composite index for the primary listing query:
  // WHERE merchant_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC
  // Covers the fast path for all paginated listing calls before filters are applied.
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_path_listing
    ON payments (merchant_id, created_at DESC)
    INCLUDE (id, amount, asset, asset_issuer, recipient, description, client_id, status, tx_id)
    WHERE deleted_at IS NULL
  `);

  // Partial index for status-filtered listing — avoids filtering the full merchant row set
  // when status = 'pending' or 'confirmed' (common dashboard filters).
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_path_status_listing
    ON payments (merchant_id, status, created_at DESC)
    INCLUDE (id, amount, asset, asset_issuer, recipient, client_id, tx_id)
    WHERE deleted_at IS NULL
  `);

  // Index for asset-filtered listing — avoids full merchant scan when filtering by asset.
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_path_asset_listing
    ON payments (merchant_id, asset, created_at DESC)
    INCLUDE (id, amount, asset_issuer, recipient, client_id, status, tx_id)
    WHERE deleted_at IS NULL
  `);

  // Index for client_id-scoped listing (per-client payment dashboards).
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_path_client_listing
    ON payments (merchant_id, client_id, created_at DESC)
    INCLUDE (id, amount, asset, status, tx_id)
    WHERE deleted_at IS NULL AND client_id IS NOT NULL
  `);

  // Index for date-range queries (date_from / date_to / created_after / created_before).
  // created_at DESC already covered by the listing index; this btree index supports
  // range scans with a merchant filter more efficiently than the DESC-ordered one.
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_path_daterange
    ON payments (merchant_id, created_at)
    WHERE deleted_at IS NULL
  `);

  // Covering index for the COUNT(*) OVER() window function in getMerchantPaymentsViaPool.
  // The planner can satisfy the query entirely from this index without a heap lookup.
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_path_count_window
    ON payments (merchant_id, created_at DESC, id)
    WHERE deleted_at IS NULL
  `);

  // Index for path-payment quote lookup by payment id + status.
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_path_quote
    ON payments (id, status)
    INCLUDE (amount, asset, asset_issuer, recipient)
    WHERE deleted_at IS NULL
  `);

  console.log("✓ Added Path Payment Service SQL optimisation indexes");
}

export async function down(knex) {
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_path_listing");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_path_status_listing");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_path_asset_listing");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_path_client_listing");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_path_daterange");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_path_count_window");
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_path_quote");
  console.log("✓ Removed Path Payment Service SQL optimisation indexes");
}
