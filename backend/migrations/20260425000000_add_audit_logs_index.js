export async function up(knex) {
  // Create a composite index to drastically speed up paginated log queries that order by timestamp
  // Issue #621
  await knex.schema.alterTable("audit_logs", (t) => {
    t.index(["merchant_id", "timestamp"], "audit_logs_merchant_id_timestamp_idx", { indexType: "btree" });
  });
}

export async function down(knex) {
  await knex.schema.alterTable("audit_logs", (t) => {
    t.dropIndex(["merchant_id", "timestamp"], "audit_logs_merchant_id_timestamp_idx");
  });
}
