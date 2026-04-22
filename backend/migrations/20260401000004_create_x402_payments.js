export async function up(knex) {
  await knex.schema.createTableIfNotExists("x402_payments", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.text("tx_hash").unique().notNullable();
    t.decimal("amount", 18, 7).notNullable();
    t.text("recipient").notNullable();
    t.text("memo").notNullable();
    t.text("access_token_hash").notNullable();
    t.timestamp("verified_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw("create index if not exists x402_payments_tx_hash_idx on x402_payments(tx_hash)");
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("x402_payments");
}
