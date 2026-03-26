-- Migration: Add recipient field to merchants for SEP-0010 auth
-- Issue #148: SEP-0010 Stellar Web Authentication Support

alter table merchants add column if not exists recipient text;

create index if not exists merchants_recipient_idx on merchants(recipient);

comment on column merchants.recipient is 'Stellar public key for SEP-0010 wallet authentication';
