-- Migration: Add audit logs table for merchant profile changes
-- Issue #155: Merchant Profile Change Audit Logs

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

-- Function to log merchant changes
create or replace function log_merchant_changes()
returns trigger as $$
begin
  -- Log API key changes
  if old.api_key is distinct from new.api_key then
    insert into audit_logs (merchant_id, action, field_changed, old_value, new_value)
    values (new.id, 'update', 'api_key', '[REDACTED]', '[REDACTED]');
  end if;

  -- Log webhook secret changes
  if old.webhook_secret is distinct from new.webhook_secret then
    insert into audit_logs (merchant_id, action, field_changed, old_value, new_value)
    values (new.id, 'update', 'webhook_secret', '[REDACTED]', '[REDACTED]');
  end if;

  -- Log email changes
  if old.email is distinct from new.email then
    insert into audit_logs (merchant_id, action, field_changed, old_value, new_value)
    values (new.id, 'update', 'email', old.email, new.email);
  end if;

  -- Log notification email changes
  if old.notification_email is distinct from new.notification_email then
    insert into audit_logs (merchant_id, action, field_changed, old_value, new_value)
    values (new.id, 'update', 'notification_email', old.notification_email, new.notification_email);
  end if;

  return new;
end;
$$ language plpgsql;

-- Create trigger for merchant updates
drop trigger if exists merchant_changes_trigger on merchants;
create trigger merchant_changes_trigger
  after update on merchants
  for each row
  execute function log_merchant_changes();
