/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn("merchants", "webhook_version");
  if (!has) {
    await knex.schema.alterTable("merchants", (table) => {
      table.text("webhook_version").notNullable().defaultTo("v1");
    });
  }
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
