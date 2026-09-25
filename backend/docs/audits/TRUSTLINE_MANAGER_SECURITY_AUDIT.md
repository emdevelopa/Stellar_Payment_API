# Security Audit — Trustline Manager (issue #598)

## Scope & method

Static review of the entire `backend/` tree for any trustline-management surface:
`changeTrust` / `change_trust` / `allowTrust` operations, `Asset` trustline
handling, and any module named "Trustline Manager".

## Finding: no Trustline Manager module exists

There is **no trustline-management code in the repository**:

- `grep -rniE "changeTrust|change_trust|allowTrust|trustline"` over `backend/src`
  returns **zero** matches.
- The only Stellar asset/operation surface is in `src/lib/stellar.js`:
  - `StellarSdk.Asset.native()` (native XLM only) — `stellar.js:237`
  - `StellarSdk.Operation.payment(...)` — `stellar.js:638`
  - `findStrictReceivePaths(...)` (strict-receive path **quoting**, read-only) — `stellar.js:418`
  - `verifyTransactionSignature(...)` (signature verification) — `stellar.js:731`

The platform settles payments against assets the receiving account already
trusts; it never builds, submits, or manages `changeTrust` operations on behalf
of users. So there is no Trustline Manager to audit.

## Security implication of the current design

Because the backend never issues `changeTrust`, the trustline attack surface
(unbounded trust limits, trusting an attacker-controlled issuer, trustline
removal griefing) **does not exist server-side** — trust decisions remain with
the end user's wallet. This is the safer default.

## Recommendations (for if/when a Trustline Manager is introduced)

If trustline management is added later, the audit checklist should be:

1. **Issuer allow-listing** — never `changeTrust` to an arbitrary
   caller-supplied issuer; validate against a vetted asset registry.
2. **Explicit trust limits** — set a bounded `limit` rather than the max default.
3. **Authorization** — gate any trustline mutation behind `requireApiKeyAuth`
   and merchant scoping (the pattern already used for `/api/payments*` in
   `src/app.js:282`).
4. **Signature verification** — reuse `verifyTransactionSignature`
   (`src/lib/stellar.js:731`) before submitting any user-authorized changeTrust.
5. **Idempotency** — route mutations through `idempotencyMiddleware`.

## Conclusion

No action possible against a non-existent module; documented the absence, the
(safe) reason for it, and the audit criteria for a future implementation. This
issue should be re-scoped to "build a Trustline Manager" before code work is
meaningful.
