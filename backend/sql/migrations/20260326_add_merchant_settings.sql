alter table merchants
add column if not exists merchant_settings jsonb not null default '{"send_success_emails": true}'::jsonb;
