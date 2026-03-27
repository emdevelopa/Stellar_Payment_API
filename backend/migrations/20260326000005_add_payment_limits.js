/**
 * Migration 005: Add payment_limits column to merchants.
 * Stores per-asset min/max as JSONB:
 *   { "XLM": { "min": 0.01, "max": 10000 }, "USDC": { "min": 1, "max": 100000 } }
 */

export async function up(knex) {
  await knex.raw(
    "alter table merchants add column if not exists payment_limits jsonb"
  );
}

export async function down(knex) {
  await knex.schema.alterTable("merchants", (t) => {
    t.dropColumn("payment_limits");
  });
}
