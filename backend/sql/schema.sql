create table if not exists merchants (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  business_name text not null,
  notification_email text not null,
  api_key text unique not null,
  webhook_secret text not null,
  webhook_version text not null default 'v1',
  webhook_secret_old text,
  webhook_secret_expiry timestamptz,
  recipient text,
  branding_config jsonb,
  merchant_settings jsonb not null default '{"send_success_emails": true}'::jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key,
  merchant_id uuid references merchants(id) on delete set null,
  client_id text,
  amount numeric(18, 7) not null,
  asset text not null,
  asset_issuer text,
  recipient text not null,
  description text,
  memo text,
  memo_type text,
  webhook_url text,
  status text not null default 'pending',
  tx_id text,
  completion_duration_seconds integer,
  metadata jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists payments_status_idx on payments(status);
create index if not exists payments_merchant_idx on payments(merchant_id);
create index if not exists payments_client_idx on payments(client_id);
create index if not exists payments_deleted_at_idx on payments(deleted_at);

create table if not exists webhook_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references payments(id) on delete cascade,
  status_code integer not null,
  request_payload jsonb,
  request_headers jsonb,
  response_body text,
  timestamp timestamptz not null default now()
);

create index if not exists webhook_delivery_logs_payment_idx on webhook_delivery_logs(payment_id);
create index if not exists webhook_delivery_logs_timestamp_idx on webhook_delivery_logs(timestamp);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  action text not null,
  field_changed text,
  old_value text,
  new_value text,
  ip_address text,
  user_agent text,
  timestamp timestamptz not null default now()
);

create index if not exists audit_logs_merchant_idx on audit_logs(merchant_id);
create index if not exists audit_logs_timestamp_idx on audit_logs(timestamp desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security (RLS) — Issue #223
--
-- Design intent
-- ─────────────
-- The backend uses a service-role key (SUPABASE_SERVICE_KEY) to bypass RLS
-- for trusted server-to-server operations such as payment creation and
-- verification, while the anon / user-facing JWT path is locked down to the
-- owning merchant only.
--
-- Two helper functions translate the current session context into a
-- merchant identifier:
--
--   auth.uid()           – Supabase JWT subject claim (UUID)
--   current_setting(…)   – custom session variable set by the API layer via
--                          SET LOCAL app.current_merchant_id = '<uuid>' inside
--                          each database transaction when the service-role key
--                          is used server-side.
--
-- Policies rely on either mechanism so both the Supabase JS client (user
-- sessions) and the Express backend (service-role with explicit session var)
-- are covered.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── merchants table ──────────────────────────────────────────────────────────

alter table merchants enable row level security;

-- A merchant may only read their own row.
create policy merchants_select_own
  on merchants for select
  using (
    id = auth.uid()
    or id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
  );

-- Only the service role (bypasses RLS) or the owning merchant may update.
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

-- New merchants are created exclusively by the backend service-role (INSERT
-- bypasses RLS when using the service key); no anon INSERT policy needed.
-- create policy merchants_insert … omitted intentionally.

-- ── payments table ───────────────────────────────────────────────────────────

alter table payments enable row level security;

-- Merchants may only SELECT their own payments.
create policy payments_select_own
  on payments for select
  using (
    merchant_id = auth.uid()
    or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
  );

-- Merchants may only INSERT payments that belong to them.
create policy payments_insert_own
  on payments for insert
  with check (
    merchant_id = auth.uid()
    or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
  );

-- Status updates (pending → confirmed / failed) must stay within the same
-- merchant's data.
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

-- ── audit_logs table ─────────────────────────────────────────────────────────

alter table audit_logs enable row level security;

create policy audit_logs_select_own
  on audit_logs for select
  using (
    merchant_id = auth.uid()
    or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
  );

create policy audit_logs_insert_own
  on audit_logs for insert
  with check (
    merchant_id = auth.uid()
    or merchant_id = nullif(current_setting('app.current_merchant_id', true), '')::uuid
  );

-- ── webhook_delivery_logs table ──────────────────────────────────────────────
-- Logs are indirectly owned by a merchant through the payment reference.
-- We join to payments to resolve the owning merchant.

alter table webhook_delivery_logs enable row level security;

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
  );
