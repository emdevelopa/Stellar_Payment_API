-- Migration: Add payment_limits config to merchants
-- Issue #153: Per-Asset Minimum/Maximum Payment Validation
--
-- Format: { "XLM": { "min": 0.01, "max": 10000 }, "USDC": { "min": 1, "max": 100000 } }

alter table merchants add column if not exists payment_limits jsonb;
