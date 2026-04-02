/**
 * x402 Payment Required middleware for PLUTO.
 *
 * Protects any Express route with a per-request USDC micropayment on Stellar.
 * When an agent hits a protected endpoint without a valid payment token,
 * it receives HTTP 402 with full payment instructions.
 *
 * Flow:
 *   Agent → GET /protected → 402 (payment details)
 *   Agent → pays USDC on Stellar → POST /api/verify-x402 → JWT token
 *   Agent → GET /protected + X-Payment-Token: <jwt> → 200 (data)
 */

import { createHmac, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

const USDC_ISSUER = process.env.USDC_ISSUER ||
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/**
 * Create x402 middleware.
 *
 * @param {object} config
 * @param {string} config.amount          - USDC amount required (e.g. "0.10")
 * @param {string} config.recipient       - Provider's Stellar address (G...)
 * @param {string} [config.asset]         - Asset code, defaults to "USDC"
 * @param {string} [config.plutoVerifyUrl] - URL of /api/verify-x402
 * @param {string} [config.memo_prefix]   - Memo prefix, defaults to "x402"
 */
export function x402Middleware(config) {
  const {
    amount,
    recipient,
    asset = "USDC",
    plutoVerifyUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/api/verify-x402`,
    memo_prefix = "x402",
  } = config;

  const jwtSecret = process.env.X402_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("X402_JWT_SECRET env variable is required for x402 middleware");
  }

  return function requirePayment(req, res, next) {
    const token = req.headers["x-payment-token"];

    if (token) {
      try {
        const payload = jwt.verify(token, jwtSecret);
        // Attach payment info to request for downstream handlers
        req.x402 = payload;
        return next();
      } catch {
        // Token invalid or expired — fall through to 402
      }
    }

    // Generate a unique memo for this specific request
    const requestId = randomUUID().replace(/-/g, "").slice(0, 16);
    const memo = `${memo_prefix}-${requestId}`;

    return res.status(402).json({
      x402: true,
      error: "Payment required",
      amount,
      asset,
      network: "stellar-testnet",
      recipient,
      asset_issuer: USDC_ISSUER,
      memo,
      verify_url: plutoVerifyUrl,
      instructions: `Send exactly ${amount} ${asset} to ${recipient} with memo "${memo}", then POST { tx_hash, expected_amount, expected_recipient, memo } to ${plutoVerifyUrl} to receive an access token, then retry this request with header X-Payment-Token: <token>`,
    });
  };
}
