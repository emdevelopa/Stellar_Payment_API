/**
 * Migration: Add audit log integrity fields for tamper detection.
 */

export async function up(knex) {
  await knex.schema.alterTable("audit_logs", (t) => {
    t.text("payload_hash");
    t.text("signature");
  });

  await knex.raw("create index if not exists audit_logs_payload_hash_idx on audit_logs(payload_hash)");
}

export async function down(knex) {
  await knex.raw("drop index if exists audit_logs_payload_hash_idx");

  await knex.schema.alterTable("audit_logs", (t) => {
    t.dropColumn("payload_hash");
    t.dropColumn("signature");
  });
}
