/**
 * Migration 003: Add audit_logs table and merchant change trigger.
 */

export async function up(knex) {
  await knex.schema.createTableIfNotExists("audit_logs", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("merchant_id").notNullable().references("id").inTable("merchants").onDelete("CASCADE");
    t.text("action").notNullable();
    t.text("field_changed");
    t.text("old_value");
    t.text("new_value");
    t.text("ip_address");
    t.text("user_agent");
    t.timestamp("timestamp", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw("create index if not exists audit_logs_merchant_idx on audit_logs(merchant_id)");
  await knex.raw("create index if not exists audit_logs_timestamp_idx on audit_logs(timestamp desc)");

  await knex.raw(`
    create or replace function log_merchant_changes()
    returns trigger as $$
    begin
      if old.api_key is distinct from new.api_key then
        insert into audit_logs (merchant_id, action, field_changed, old_value, new_value)
        values (new.id, 'update', 'api_key', '[REDACTED]', '[REDACTED]');
      end if;
      if old.webhook_secret is distinct from new.webhook_secret then
        insert into audit_logs (merchant_id, action, field_changed, old_value, new_value)
        values (new.id, 'update', 'webhook_secret', '[REDACTED]', '[REDACTED]');
      end if;
      if old.email is distinct from new.email then
        insert into audit_logs (merchant_id, action, field_changed, old_value, new_value)
        values (new.id, 'update', 'email', old.email, new.email);
      end if;
      if old.notification_email is distinct from new.notification_email then
        insert into audit_logs (merchant_id, action, field_changed, old_value, new_value)
        values (new.id, 'update', 'notification_email', old.notification_email, new.notification_email);
      end if;
      return new;
    end;
    $$ language plpgsql
  `);

  await knex.raw("drop trigger if exists merchant_changes_trigger on merchants");
  await knex.raw(`
    create trigger merchant_changes_trigger
    after update on merchants
    for each row
    execute function log_merchant_changes()
  `);
}

export async function down(knex) {
  await knex.raw("drop trigger if exists merchant_changes_trigger on merchants");
  await knex.raw("drop function if exists log_merchant_changes()");
  await knex.schema.dropTableIfExists("audit_logs");
}
