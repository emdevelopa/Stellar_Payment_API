/**
 * Migration 002: Add recipient column and index to merchants.
 */

export async function up(knex) {
  const hasRecipient = await knex.schema.hasColumn("merchants", "recipient");
  if (!hasRecipient) {
    await knex.schema.alterTable("merchants", (t) => {
      t.text("recipient");
    });
  }
  await knex.raw(
    "create index if not exists merchants_recipient_idx on merchants(recipient)"
  );
}

export async function down(knex) {
  await knex.raw("drop index if exists merchants_recipient_idx");
  await knex.schema.alterTable("merchants", (t) => {
    t.dropColumn("recipient");
  });
}
