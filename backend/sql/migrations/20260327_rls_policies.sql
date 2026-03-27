-- Migration: enable Row Level Security on all merchant-scoped tables
-- Issue #223 — database-level data isolation
--
-- Run with:  psql $DATABASE_URL -f backend/sql/migrations/20260327_rls_policies.sql
-- Idempotent: policies use IF NOT EXISTS / OR REPLACE where supported;
-- re-running on an already-migrated database is safe.
--
-- After applying this migration the backend MUST set the session variable
--   SET LOCAL app.current_merchant_id = '<merchant_uuid>'
-- within every transaction that uses the service-role key so the policies
-- can resolve the acting merchant.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── merchants ────────────────────────────────────────────────────────────────

alter table if exists merchants enable row level security;

drop policy if exists merchants_select_own on merchants;
create policy merchants_select_own
  on merchants for select
  using (
    id = auth.uid()
    or id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
  );

drop policy if exists merchants_update_own on merchants;
create policy merchants_update_own
  on merchants for update
  using (
    id = auth.uid()
    or id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
  )
  with check (
    id = auth.uid()
    or id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
  );

-- ── payments ─────────────────────────────────────────────────────────────────

alter table if exists payments enable row level security;

drop policy if exists payments_select_own on payments;
create policy payments_select_own
  on payments for select
  using (
    merchant_id = auth.uid()
    or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
  );

drop policy if exists payments_insert_own on payments;
create policy payments_insert_own
  on payments for insert
  with check (
    merchant_id = auth.uid()
    or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
  );

drop policy if exists payments_update_own on payments;
create policy payments_update_own
  on payments for update
  using (
    merchant_id = auth.uid()
    or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
  )
  with check (
    merchant_id = auth.uid()
    or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
  );

-- ── audit_logs ───────────────────────────────────────────────────────────────

alter table if exists audit_logs enable row level security;

drop policy if exists audit_logs_select_own on audit_logs;
create policy audit_logs_select_own
  on audit_logs for select
  using (
    merchant_id = auth.uid()
    or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
  );

drop policy if exists audit_logs_insert_own on audit_logs;
create policy audit_logs_insert_own
  on audit_logs for insert
  with check (
    merchant_id = auth.uid()
    or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
  );

-- ── webhook_delivery_logs ────────────────────────────────────────────────────

alter table if exists webhook_delivery_logs enable row level security;

drop policy if exists webhook_delivery_logs_select_own on webhook_delivery_logs;
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
  );
