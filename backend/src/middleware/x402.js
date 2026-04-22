/**
 * x402 Payment Required middleware for PLUTO.
 *
 * Custom implementation using standard Stellar USDC transfers.
 * Works with any Stellar wallet — no Soroban contract account needed.
 *
 * Flow:
 *   1. Client hits protected endpoint → gets 402 with payment details
 *   2. Client sends USDC on Stellar with the provided memo
 *   3. Client calls POST /api/verify-x402 { tx_hash } → gets JWT
 *   4. Client retries with X-Payment-Token: <jwt> → gets access
 */

import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

const USDC_ISSUER = process.env.USDC_ISSUER ||
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/**
 * Create x402 middleware.
 *
 * @param {object} config
 * @param {string} config.amount          - USDC amount required (e.g. "0.01")
 * @param {string} config.recipient       - Provider's Stellar address (G...)
 * @param {string} [config.asset]         - Asset code, defaults to "USDC"
 * @param {string} [config.plutoVerifyUrl] - URL of /api/verify-x402
 * @param {string} [config.memo_prefix]   - Memo prefix, defaults to "x402"
 * @param {boolean} [config.enforceByDefault] - If true, always challenge when token is absent
 */
export function x402Middleware(config) {
  const {
    amount,
    recipient,
    asset = "USDC",
    plutoVerifyUrl = `${process.env.PAYMENT_LINK_BASE?.replace(":3000", ":4000") || "http://localhost:4000"}/api/verify-x402`,
    memo_prefix = "x402",
    enforceByDefault = false,
  } = config;

  const jwtSecret = process.env.X402_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("X402_JWT_SECRET env variable is required for x402 middleware");
  }

  return function requirePayment(req, res, next) {
    const token = req.headers["x-payment-token"];
    const modeHeader = String(req.headers["x-pluto-pricing-mode"] || "")
      .trim()
      .toLowerCase();
    const modeQueryRaw = req.query?.pricing_mode;
    const modeQuery =
      typeof modeQueryRaw === "string" ? modeQueryRaw.trim().toLowerCase() : "";
    const requestedX402 = modeHeader === "x402" || modeQuery === "x402";

    if (token) {
      try {
        const payload = jwt.verify(token, jwtSecret);
        req.x402 = payload;
        return next();
      } catch {
        // Token invalid or expired — fall through to 402
      }
    }

    // Dual-mode behavior:
    // - Subscription/API-key mode: pass through
    // - x402 mode: challenge with 402
    if (!enforceByDefault && !requestedX402) {
      return next();
    }

    const requestId = randomUUID().replace(/-/g, "");
    const separator = "-";
    const maxMemoBytes = 28;
    const minIdBytes = 4;

    let memoPrefix = String(memo_prefix || "x402");
    const separatorBytes = Buffer.byteLength(separator, "utf8");
    const maxPrefixBytes = Math.max(1, maxMemoBytes - separatorBytes - minIdBytes);

    // Trim overly long prefixes so we can always include an id segment.
    while (Buffer.byteLength(memoPrefix, "utf8") > maxPrefixBytes) {
      memoPrefix = memoPrefix.slice(0, -1);
    }

    const prefixBytes = Buffer.byteLength(memoPrefix, "utf8");
    const maxIdBytes = Math.max(minIdBytes, maxMemoBytes - prefixBytes - separatorBytes);
    const idPart = requestId.slice(0, maxIdBytes);
    const memo = `${memoPrefix}${separator}${idPart}`;

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
