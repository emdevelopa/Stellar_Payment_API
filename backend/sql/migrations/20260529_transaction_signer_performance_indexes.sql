-- Migration: Add composite indexes for Transaction Signer and payment query optimization
-- Date: 2026-05-29
-- Issue: SQL Query Performance Optimization for Transaction Signer
-- Description: This migration adds composite indexes to optimize database queries used by
--              the Transaction Signer, Ledger Monitor, and payment services. The indexes
--              are created concurrently to avoid blocking production traffic.

-- Composite index for merchant payments queries
-- Covers: getMerchantPayments, getRollingMetrics in paymentService.js
-- Benefit: Eliminates separate index lookups, supports ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_merchant_deleted_created_idx 
  ON payments(merchant_id, deleted_at, created_at DESC);

-- Composite index for ledger monitor pending payments
-- Covers: pollPendingPayments in horizon-poller.js
-- Benefit: Efficient filtering and ordering for pending payment polling
CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_status_deleted_created_idx 
  ON payments(status, deleted_at, created_at ASC)
  WHERE status = 'pending';

-- Composite index for payment lookups with soft delete
-- Covers: getPaymentStatus, verifyPayment in paymentService.js
-- Benefit: Single index lookup for primary key + soft delete filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_id_deleted_idx 
  ON payments(id, deleted_at);

-- Partial index for confirmation updates
-- Covers: checkPayment atomic update in horizon-poller.js
-- Benefit: Fast lookup for pending transactions without tx_id for optimistic locking
CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_status_txid_idx 
  ON payments(status, tx_id)
  WHERE status = 'pending' AND tx_id IS NULL;

-- Composite index for merchant status queries
-- Covers: Merchant dashboard status filtering
-- Benefit: Composite filtering for merchant-specific status queries with ordering
CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_merchant_status_created_idx 
  ON payments(merchant_id, status, created_at DESC);

-- Composite index for recipient-based lookups
-- Covers: findMatchingPayment, findAnyRecentPayment in stellar.js
-- Benefit: Efficient filtering by recipient and asset for payment matching
CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_recipient_asset_created_idx 
  ON payments(recipient, asset, created_at DESC)
  WHERE deleted_at IS NULL;

-- Unique index on tx_id to prevent duplicate transaction confirmations
-- Covers: Payment confirmation atomicity
-- Benefit: Database-level guarantee that each tx_id can only confirm one payment
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS payments_tx_id_unique_idx 
  ON payments(tx_id)
  WHERE tx_id IS NOT NULL;

-- Analyze tables after index creation to update query planner statistics
ANALYZE payments;
ANALYZE merchants;
ANALYZE webhook_delivery_logs;
ANALYZE audit_logs;

-- Comment on indexes for documentation
COMMENT ON INDEX payments_merchant_deleted_created_idx IS 'Composite index for merchant payments queries with soft delete and time ordering';
COMMENT ON INDEX payments_status_deleted_created_idx IS 'Partial index for pending payment polling in Ledger Monitor';
COMMENT ON INDEX payments_id_deleted_idx IS 'Composite index for payment lookups with soft delete filter';
COMMENT ON INDEX payments_status_txid_idx IS 'Partial index for pending transactions without tx_id for optimistic locking';
COMMENT ON INDEX payments_merchant_status_created_idx IS 'Composite index for merchant dashboard status queries';
COMMENT ON INDEX payments_recipient_asset_created_idx IS 'Composite index for recipient-based payment matching';
COMMENT ON INDEX payments_tx_id_unique_idx IS 'Unique index to prevent duplicate transaction confirmations';
