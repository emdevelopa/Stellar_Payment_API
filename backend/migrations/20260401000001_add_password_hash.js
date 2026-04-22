export async function up(knex) {
  await knex.schema.alterTable("merchants", (t) => {
    t.text("password_hash").nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable("merchants", (t) => {
    t.dropColumn("password_hash");
  });
}
