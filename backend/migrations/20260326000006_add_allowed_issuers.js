/**
 * Migration 006: Add allowed_issuers column to merchants.
 * Stores an array of trusted Stellar issuer addresses as JSONB:
 *   ["GA5Z6XZ...", "GBPK2A6..."]
 * An empty array (or null) means all issuers are accepted.
 */

export async function up(knex) {
  await knex.raw(
    "alter table merchants add column if not exists allowed_issuers jsonb"
  );
}

export async function down(knex) {
  await knex.schema.alterTable("merchants", (t) => {
    t.dropColumn("allowed_issuers");
  });
}
