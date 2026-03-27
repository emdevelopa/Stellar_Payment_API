/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.alterTable("merchants", (table) => {
    // Default 'v1' ensures every existing merchant keeps receiving the
    // payload format they integrated against without any manual data migration.
    table.text("webhook_version").notNullable().defaultTo("v1");
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.alterTable("merchants", (table) => {
    table.dropColumn("webhook_version");
  });
}
