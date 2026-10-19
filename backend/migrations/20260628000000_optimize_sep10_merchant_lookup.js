/**
 * Migration: Optimize SEP-10 Authentication SQL queries
 * Issue #586: Optimize SQL queries in SEP-10 Authentication
 *
 * The SEP-10 verify path (`lookupMerchantByStellarAddress`) runs, per login:
 *
 *   SELECT id, email, business_name, notification_email
 *   FROM merchants
 *   WHERE recipient = $1 AND deleted_at IS NULL
 *   LIMIT 2
 *
 * The existing `merchants_recipient_idx` (recipient) finds candidate rows but
 * still has to visit the heap for every match — including soft-deleted
 * merchants — to check `deleted_at` and read the selected columns. This
 * partial covering index holds only active merchants and carries the
 * selected columns, so the lookup is an index-only scan.
 *
 * CONCURRENTLY avoids locking `merchants` in production, and cannot run
 * inside a transaction, hence `config.transaction = false`.
 */

export const config = { transaction: false };

export async function up(knex) {
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_sep10_active_recipient
    ON merchants (recipient)
    INCLUDE (id, email, business_name, notification_email)
    WHERE deleted_at IS NULL
  `);

  console.log("✓ Added SEP-10 merchant lookup index");
}

export async function down(knex) {
  await knex.raw("DROP INDEX CONCURRENTLY IF EXISTS idx_merchants_sep10_active_recipient");
  console.log("✓ Removed SEP-10 merchant lookup index");
}
