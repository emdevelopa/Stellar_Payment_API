/**
 * Migration 006: Add metadata column to merchants.
 * Stores arbitrary onboarding data (e.g. industry, country) as JSONB.
 */

export async function up(knex) {
  await knex.raw(
    "alter table merchants add column if not exists metadata jsonb"
  );
}

export async function down(knex) {
  await knex.schema.alterTable("merchants", (t) => {
    t.dropColumn("metadata");
  });
}
