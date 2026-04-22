/**
 * Migration 001: Initial schema
 * Creates merchants, payments, and webhook_delivery_logs tables.
 */

export async function up(knex) {
  await knex.schema.createTableIfNotExists("merchants", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.text("email").unique().notNullable();
    t.text("business_name").notNullable();
    t.text("notification_email").notNullable();
    t.text("api_key").unique().notNullable();
    t.text("webhook_secret").notNullable();
    t.text("webhook_version").notNullable().defaultTo("v1");
    t.text("webhook_secret_old");
    t.timestamp("webhook_secret_expiry", { useTz: true });
    t.text("recipient");
    t.jsonb("branding_config");
    t.jsonb("merchant_settings").notNullable().defaultTo(
      knex.raw("'{\"send_success_emails\": true}'::jsonb")
    );
    t.jsonb("metadata");
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTableIfNotExists("payments", (t) => {
    t.uuid("id").primary();
    t.uuid("merchant_id").references("id").inTable("merchants").onDelete("SET NULL");
    t.text("client_id");
    t.decimal("amount", 18, 7).notNullable();
    t.text("asset").notNullable();
    t.text("asset_issuer");
    t.text("recipient").notNullable();
    t.text("description");
    t.text("memo");
    t.text("memo_type");
    t.text("webhook_url");
    t.text("status").notNullable().defaultTo("pending");
    t.text("tx_id");
    t.integer("completion_duration_seconds");
    t.jsonb("metadata");
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp("deleted_at", { useTz: true });
  });

  await knex.raw(
    "create index if not exists payments_status_idx on payments(status)"
  );
  await knex.raw(
    "create index if not exists payments_merchant_idx on payments(merchant_id)"
  );
  await knex.raw(
    "create index if not exists payments_client_idx on payments(client_id)"
  );
  await knex.raw(
    "create index if not exists payments_deleted_at_idx on payments(deleted_at)"
  );

  await knex.schema.createTableIfNotExists("webhook_delivery_logs", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("payment_id").references("id").inTable("payments").onDelete("CASCADE");
    t.integer("status_code").notNullable();
    t.jsonb("request_payload");
    t.jsonb("request_headers");
    t.text("response_body");
    t.timestamp("timestamp", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    "create index if not exists webhook_delivery_logs_payment_idx on webhook_delivery_logs(payment_id)"
  );
  await knex.raw(
    "create index if not exists webhook_delivery_logs_timestamp_idx on webhook_delivery_logs(timestamp)"
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("webhook_delivery_logs");
  await knex.schema.dropTableIfExists("payments");
  await knex.schema.dropTableIfExists("merchants");
}
