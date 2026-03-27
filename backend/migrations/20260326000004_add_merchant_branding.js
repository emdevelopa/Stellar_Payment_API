/**
 * Migration 004: Ensure branding_config column exists on merchants.
 * Safe to run on existing databases that pre-date the initial schema migration.
 */

export async function up(knex) {
  await knex.raw(
    "alter table merchants add column if not exists branding_config jsonb"
  );
}

export async function down(knex) {
  await knex.schema.alterTable("merchants", (t) => {
    t.dropColumn("branding_config");
  });
}
