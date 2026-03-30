/**
 * Migration: Add Row Level Security (RLS) policies
 *
 * Mirrors backend/sql/schema.sql RLS setup so local dev can run `npm run migrate`
 * instead of copy-pasting SQL into Supabase.
 */

export async function up(knex) {
  await knex.raw("alter table merchants enable row level security");
  await knex.raw("alter table payments enable row level security");
  await knex.raw("alter table audit_logs enable row level security");
  await knex.raw("alter table webhook_delivery_logs enable row level security");

  await knex.raw(`
    create policy merchants_select_own
      on merchants for select
      using (
        id = auth.uid()
        or id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
      )
  `);

  await knex.raw(`
    create policy merchants_update_own
      on merchants for update
      using (
        id = auth.uid()
        or id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
      )
      with check (
        id = auth.uid()
        or id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
      )
  `);

  await knex.raw(`
    create policy payments_select_own
      on payments for select
      using (
        merchant_id = auth.uid()
        or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
      )
  `);

  await knex.raw(`
    create policy payments_insert_own
      on payments for insert
      with check (
        merchant_id = auth.uid()
        or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
      )
  `);

  await knex.raw(`
    create policy payments_update_own
      on payments for update
      using (
        merchant_id = auth.uid()
        or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
      )
      with check (
        merchant_id = auth.uid()
        or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
      )
  `);

  await knex.raw(`
    create policy audit_logs_select_own
      on audit_logs for select
      using (
        merchant_id = auth.uid()
        or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
      )
  `);

  await knex.raw(`
    create policy audit_logs_insert_own
      on audit_logs for insert
      with check (
        merchant_id = auth.uid()
        or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
      )
  `);

  await knex.raw(`
    create policy webhook_delivery_logs_select_own
      on webhook_delivery_logs for select
      using (
        exists (
          select 1 from payments p
          where p.id = webhook_delivery_logs.payment_id
            and (
              p.merchant_id = auth.uid()
              or p.merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
            )
        )
      )
  `);

  await knex.raw(`
    create policy webhook_delivery_logs_insert_own
      on webhook_delivery_logs for insert
      with check (
        exists (
          select 1 from payments p
          where p.id = webhook_delivery_logs.payment_id
            and (
              p.merchant_id = auth.uid()
              or p.merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
            )
        )
      )
  `);
}

export async function down(knex) {
  await knex.raw("drop policy if exists webhook_delivery_logs_insert_own on webhook_delivery_logs");
  await knex.raw("drop policy if exists webhook_delivery_logs_select_own on webhook_delivery_logs");
  await knex.raw("drop policy if exists audit_logs_insert_own on audit_logs");
  await knex.raw("drop policy if exists audit_logs_select_own on audit_logs");
  await knex.raw("drop policy if exists payments_update_own on payments");
  await knex.raw("drop policy if exists payments_insert_own on payments");
  await knex.raw("drop policy if exists payments_select_own on payments");
  await knex.raw("drop policy if exists merchants_update_own on merchants");
  await knex.raw("drop policy if exists merchants_select_own on merchants");

  await knex.raw("alter table webhook_delivery_logs disable row level security");
  await knex.raw("alter table audit_logs disable row level security");
  await knex.raw("alter table payments disable row level security");
  await knex.raw("alter table merchants disable row level security");
}
