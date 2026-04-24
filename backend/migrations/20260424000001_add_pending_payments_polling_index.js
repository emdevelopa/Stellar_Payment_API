/**
 * Add a partial index for the Ledger Monitor pending-payment scan.
 *
 * The poller filters on status + created_at and excludes soft-deleted rows,
 * so this partial index lets Postgres satisfy that query without scanning the
 * broader payments indexes.
 */

export async function up(knex) {
  await knex.raw(
    "CREATE INDEX IF NOT EXISTS payments_pending_created_idx ON payments(status, created_at ASC) WHERE deleted_at IS NULL",
  );

  console.log("✓ Added payments_pending_created_idx for Ledger Monitor polling");
}

export async function down(knex) {
  await knex.raw("DROP INDEX IF EXISTS payments_pending_created_idx");
  console.log("✓ Removed payments_pending_created_idx");
}