-- Migration: add webhook_url column to merchants table
-- This allows merchants to configure a default webhook endpoint in settings.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS webhook_url text;
