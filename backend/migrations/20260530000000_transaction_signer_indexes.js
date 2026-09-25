/**
 * Add performance indexes for Transaction Signer and payment query optimization.
 * Issue #914 — Optimize SQL queries in Transaction Signer
 *
 * Promotes the raw SQL from backend/sql/migrations/20260529_transaction_signer_performance_indexes.sql
 * into a tracked knex migration so indexes are applied automatically on deployment.
 */

export async function up(knex) {
  // Composite index for merchant payments queries
  // Covers: getMerchantPayments, getRollingMetrics in paymentService.js
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_merchant_deleted_created_idx
    ON payments(merchant_id, deleted_at, created_at DESC)
  `);

  // Partial index for pending payment polling in Ledger Monitor
  // Covers: pollPendingPayments in horizon-poller.js
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_status_deleted_created_idx
    ON payments(status, deleted_at, created_at ASC)
    WHERE status = 'pending'
  `);

  // Composite index for payment lookups with soft delete
  // Covers: getPaymentStatus, verifyPayment in paymentService.js
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_id_deleted_idx
    ON payments(id, deleted_at)
  `);

  // Partial index for confirmation updates — optimistic locking on unclaimed rows
  // Covers: checkPayment atomic update in horizon-poller.js
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_status_txid_idx
    ON payments(status, tx_id)
    WHERE status = 'pending' AND tx_id IS NULL
  `);

  // Composite index for merchant status queries
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_merchant_status_created_idx
    ON payments(merchant_id, status, created_at DESC)
  `);

  // Composite index for recipient-based payment matching
  // Covers: findMatchingPayment, findAnyRecentPayment in stellar.js
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_recipient_asset_created_idx
    ON payments(recipient, asset, created_at DESC)
    WHERE deleted_at IS NULL
  `);

  // Unique index on tx_id — database-level guarantee against duplicate confirmations
  await knex.raw(`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS payments_tx_id_unique_idx
    ON payments(tx_id)
    WHERE tx_id IS NOT NULL
  `);

  await knex.raw("ANALYZE payments");

  console.log("✓ Added transaction signer and payment query optimization indexes");
}

export async function down(knex) {
  const indexes = [
    "payments_merchant_deleted_created_idx",
    "payments_status_deleted_created_idx",
    "payments_id_deleted_idx",
    "payments_status_txid_idx",
    "payments_merchant_status_created_idx",
    "payments_recipient_asset_created_idx",
    "payments_tx_id_unique_idx",
  ];

  for (const idx of indexes) {
    await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${idx}`);
  }

  console.log("✓ Removed transaction signer optimization indexes");
}
