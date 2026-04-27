/**
 * Migration: Add milestones table
 * Linked to merchants (adaption from profile model)
 */

export async function up(knex) {
  await knex.schema.createTableIfNotExists("milestones", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("merchant_id")
      .references("id")
      .inTable("merchants")
      .onDelete("CASCADE");
    t.text("title").notNullable();
    t.text("description");
    t.decimal("target_amount", 18, 7).notNullable();
    t.decimal("current_amount", 18, 7).notNullable().defaultTo(0);
    t.text("asset_code").notNullable().defaultTo("XLM");
    t.text("status").notNullable().defaultTo("active");
    t.timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    t.timestamp("updated_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(
    "create index if not exists milestones_merchant_id_idx on milestones(merchant_id)"
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("milestones");
}
