# Ledger Monitor Security and Optimization Notes

## Issues covered

- #773: Internal rate limiting for Ledger Monitor Horizon calls.
- #774: Cryptographic signature verification for all transaction-driven status changes.
- #775: SQL query optimization for pending-payment polling.
- #776: Error recovery improvements around transient database and cache failures.

## Security notes

- `LEDGER_MONITOR_HORIZON_RPS` controls the maximum Horizon requests per second made by the monitor. The default is `5`.
- Exact-match, underpayment, and overpayment transaction hashes are verified with `verifyTransactionSignature` before the monitor updates payment state.
- Signature verification failures leave payments pending so the monitor can retry on a later cycle.
- Cache invalidation failures are logged but do not block already-confirmed payment notifications.

## Database notes

- Pending scans now filter out rows with `tx_id IS NOT NULL`.
- Migration `20260529000000_optimize_ledger_monitor_pending_scan.js` adds a partial index for active pending rows:
  `status = 'pending' AND deleted_at IS NULL AND tx_id IS NULL`.

## Recovery notes

- Transient database update errors are retried with short exponential backoff.
- Existing circuit-breaker behavior remains in place for repeated full-cycle failures.
