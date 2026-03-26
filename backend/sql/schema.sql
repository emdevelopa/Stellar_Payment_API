create table if not exists merchants (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  business_name text not null,
  notification_email text not null,
  api_key text unique not null,
  webhook_secret text not null,
  webhook_version text not null default 'v1',
  recipient text,
  branding_config jsonb,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key,
  merchant_id uuid references merchants(id) on delete set null,
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
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payments_status_idx on payments(status);
create index if not exists payments_merchant_idx on payments(merchant_id);

create table if not exists webhook_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references payments(id) on delete cascade,
  status_code integer not null,
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
