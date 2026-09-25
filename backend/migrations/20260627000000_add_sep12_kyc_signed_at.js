/**
 * Migration: SEP-12 KYC signed_at
 *
 * Records the signed request timestamp of the last accepted write so the PUT
 * upsert can reject older/concurrent/replayed requests instead of letting the
 * last arrival overwrite newer data.
 */

export async function up(knex) {
  await knex.raw(`
    ALTER TABLE sep12_kyc_customers
    ADD COLUMN IF NOT EXISTS signed_at bigint NOT NULL DEFAULT 0
  `);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE sep12_kyc_customers DROP COLUMN IF EXISTS signed_at`);
}
