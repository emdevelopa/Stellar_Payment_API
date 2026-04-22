/**
 * Add a partial unique index on payments.tx_id (excluding NULLs).
 * This prevents two payments from ever being confirmed with the same
 * on-chain transaction hash at the database level.
 */
export async function up(knex) {
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS payments_tx_id_unique
    ON payments (tx_id)
    WHERE tx_id IS NOT NULL
  `);
}

export async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS payments_tx_id_unique`);
}
