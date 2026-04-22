/**
 * Migration: add webhook_url and subscribed_events columns to merchants
 */
export async function up(knex) {
  await knex.schema.alterTable("merchants", (table) => {
    table.text("webhook_url");
    table.jsonb("subscribed_events").nullable().defaultTo(null);
  });
}

export async function down(knex) {
  await knex.schema.alterTable("merchants", (table) => {
    table.dropColumn("webhook_url");
    table.dropColumn("subscribed_events");
  });
}
