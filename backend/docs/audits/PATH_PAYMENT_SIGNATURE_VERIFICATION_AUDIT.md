# Security Audit — Path Payment Service signature verification (issue #600)

## Scope & method

Review whether the Path Payment Service performs cryptographic signature
verification, where it is enforced, and whether the implementation is sound.

## Finding: full Ed25519 signature verification already exists and is enforced

`verifyTransactionSignature(txHash)` in `src/lib/stellar.js:731` performs
**complete** cryptographic verification, not a presence check:

1. Fetches the transaction and deserialises its XDR envelope.
2. Rejects envelopes with **no signatures** (`stellar.js:782`).
3. Loads the source account to read its signers and **medium threshold**.
4. For every decorated signature, derives the signer, performs a real
   **Ed25519 `keyPair.verify(txHashBytes, sigBytes)`** (`stellar.js:846`), and
   accumulates signing weight.
5. Tracks `usedSigners` to **prevent signature replay** (`stellar.js:828`).
6. Accepts only when accumulated weight meets the account's medium threshold.

It is wired into the payment-verification flow via
`verifyTransactionSignatureIfAvailable(...)`:

- `src/routes/payments.js:601` — verification endpoint checks the matched
  transaction's signature and rejects via `isSignatureVerificationAccepted(...)`.
- `src/services/paymentService.js:107` / `verifyPayment(...)` (`paymentService.js:618`).

Existing test coverage: `src/lib/signature-verification.test.js`,
`src/lib/transaction-signer.test.js`, `src/routes/payments-security.test.js`.

## Why the read-only quote endpoint is intentionally unsigned

`GET /api/path-payment-quote/:id` (`src/routes/payments.js:1137`) is **public by
design**: the customer-facing payment page calls it with no API key
(`frontend/src/app/pay/[id]/page.tsx:304`) because the payer needs the quote
(amount/asset/path) to construct their own transaction. It performs no state
change and exposes only data already inherent to the public payment link, so it
is correctly **not** gated by signature/API-key auth. Adding mandatory
verification here would break checkout without a security benefit.

## Conclusion

The cryptographic signature verification this issue asks for is **already
implemented, enforced on the state-changing path, and tested**. No code change
was warranted; this audit documents the coverage and the deliberate public-read
exception.
