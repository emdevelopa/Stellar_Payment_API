# Fraud Detection Engine Optimization Notes

## Scope

This note covers the fraud detection cache hardening and admin dashboard load-test coverage added for the Stellar Wave backend optimization tasks.

## Cache integrity

- Risk cache keys now include amount, status, creation time, memo, and metadata fingerprint in addition to merchant, recipient, and asset.
- Cached entries expire after five minutes and are pruned before cache stats are reported.
- Cache size is capped to protect long-running workers from unbounded growth during burst traffic.

## Load testing

- Admin dashboard load scenarios cover overview, payment feed, and metrics endpoints.
- Thresholds reuse the shared load-test defaults so the plan stays aligned with the existing backend load-test suite.

## Security notes

The cache now avoids reusing a low-risk result for a materially different payment payload. This keeps transient optimization from masking high-risk amount, memo, or metadata changes.
