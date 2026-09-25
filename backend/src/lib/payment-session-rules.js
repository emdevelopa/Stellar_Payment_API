/**
 * payment-session-rules.js
 *
 * Shared business-rule validation for payment session creation (issue #1087).
 *
 * This logic previously lived duplicated in two places with subtly different
 * response handling but identical rule ordering:
 *
 *   - src/routes/payments.js  → createSession (responds 400 JSON + metrics)
 *   - src/services/paymentService.js → createPaymentSession (throws err.status)
 *
 * Both call sites now evaluate the SAME pure functions here and map the
 * resulting rejection descriptor to their own transport (HTTP response vs
 * thrown error). The rules and their order are:
 *
 *   1. Issuer presence   – non-native assets must carry an asset_issuer
 *   2. Issuer format     – must be a valid Stellar public key (G...)
 *   3. Per-asset limits  – merchant-configured min/max for the asset
 *   4. Allowed issuers   – merchant allowlist (when non-empty)
 *
 * The module is intentionally free of I/O, logging and metrics so it can be
 * unit-tested exhaustively and safely reused.
 */

import { isValidStellarPublicKey } from "./stellar.js";
import { resolveAssetIssuer } from "../constants/assetConstants.js";

/**
 * Resolve and validate the asset issuer for a payment session.
 *
 * @param {string} asset       Normalized (uppercase) asset code
 * @param {string|null} rawIssuer Raw asset_issuer supplied by the client
 * @returns {{ assetIssuer: string|null, rejection: null }}
 *   | {{ assetIssuer: null, rejection: {reason, message} }}
 */
function resolveAndValidateIssuer(asset, rawIssuer) {
  const assetIssuer = resolveAssetIssuer(asset, rawIssuer);

  if (asset !== "XLM" && !assetIssuer) {
    return {
      assetIssuer: null,
      rejection: {
        reason: "missing_issuer",
        message: "asset_issuer is required for non-native assets",
      },
    };
  }

  if (asset !== "XLM" && !isValidStellarPublicKey(assetIssuer)) {
    return {
      assetIssuer: null,
      rejection: {
        reason: "invalid_issuer",
        message: "asset_issuer must be a valid Stellar public key",
      },
    };
  }

  return { assetIssuer, rejection: null };
}

/**
 * Enforce per-asset min/max payment limits configured on the merchant.
 *
 * Lookup uses the RAW asset string exactly as the legacy implementations did
 * (`payment_limits[body.asset]`) so existing merchant configs keep working
 * regardless of casing.
 *
 * @param {object} params
 * @param {string} params.rawAsset     Asset code as sent by the client
 * @param {number} params.amount       Requested amount
 * @param {object|null} params.paymentLimits Merchant payment_limits object
 * @returns {{reason:"below_min"|"above_max", message, details}|null}
 */
function validatePerAssetLimits({ rawAsset, amount, paymentLimits }) {
  if (!paymentLimits || typeof paymentLimits !== "object") {
    return null;
  }

  const assetLimits = paymentLimits[rawAsset];
  if (!assetLimits) {
    return null;
  }

  if (assetLimits.min !== undefined && amount < assetLimits.min) {
    return {
      reason: "below_min",
      message: `Amount is below the minimum for ${rawAsset}`,
      details: {
        min: assetLimits.min,
        delta: Number((assetLimits.min - amount).toFixed(7)),
      },
    };
  }

  if (assetLimits.max !== undefined && amount > assetLimits.max) {
    return {
      reason: "above_max",
      message: `Amount exceeds the maximum for ${rawAsset}`,
      details: {
        max: assetLimits.max,
        delta: Number((amount - assetLimits.max).toFixed(7)),
      },
    };
  }

  return null;
}

/**
 * Enforce the merchant's issuer allowlist. An empty/absent allowlist permits
 * any (already format-validated) issuer.
 *
 * @param {object} params
 * @param {string} params.asset             Normalized asset code
 * @param {string|null} params.assetIssuer  Resolved issuer
 * @param {string[]|undefined} params.allowedIssuers Merchant allowlist
 * @returns {{reason:"issuer_not_allowed", message}|null}
 */
function validateAllowedIssuers({ asset, assetIssuer, allowedIssuers }) {
  if (
    asset === "XLM" ||
    !Array.isArray(allowedIssuers) ||
    allowedIssuers.length === 0
  ) {
    return null;
  }

  if (!assetIssuer || !allowedIssuers.includes(assetIssuer)) {
    return {
      reason: "issuer_not_allowed",
      message: "asset_issuer is not in the merchant's list of allowed issuers",
    };
  }

  return null;
}

export {
  resolveAndValidateIssuer,
  validatePerAssetLimits,
  validateAllowedIssuers,
};
