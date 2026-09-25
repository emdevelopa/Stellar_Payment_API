/**
 * Optimize the Ledger Monitor pending-payment scan.
 *
 * The monitor now excludes rows that have already claimed a tx_id, so this
 * partial covering index keeps the polling query narrow even as payments grow.
 */

export async function up(knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS payments_ledger_monitor_pending_idx
    ON payments (created_at ASC)
    WHERE status = 'pending'
      AND deleted_at IS NULL
      AND tx_id IS NULL
  `);

  console.log("✓ Added payments_ledger_monitor_pending_idx for Ledger Monitor polling");
}

export async function down(knex) {
  await knex.raw("DROP INDEX IF EXISTS payments_ledger_monitor_pending_idx");
  console.log("✓ Removed payments_ledger_monitor_pending_idx");
}
