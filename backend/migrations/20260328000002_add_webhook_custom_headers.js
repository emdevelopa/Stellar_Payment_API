/**
 * Migration: add webhook_custom_headers column to merchants
 *
 * Stores an optional JSON object of extra HTTP headers that should be
 * forwarded with every webhook POST for this merchant, e.g.
 *   { "X-My-Auth": "token123", "X-Source": "stellar-pay" }
 *
 * Header names are restricted to safe ASCII characters; values must be
 * non-empty strings.  Validation is enforced at the application layer.
 */
export async function up(knex) {
  await knex.schema.alterTable("merchants", (table) => {
    table
      .jsonb("webhook_custom_headers")
      .nullable()
      .defaultTo(null)
      .comment("Merchant-defined extra headers merged into webhook POSTs");
  });
}

export async function down(knex) {
  await knex.schema.alterTable("merchants", (table) => {
    table.dropColumn("webhook_custom_headers");
  });
}
