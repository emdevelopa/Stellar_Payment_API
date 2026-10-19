/**
 * Stellar Validators - Input validation and asset management
 * 
 * This module handles all validation logic for Stellar-related inputs:
 * - Public key validation
 * - Asset code validation  
 * - Memo validation
 * - Asset resolution
 */

import * as StellarSdk from "stellar-sdk";

// Validation patterns
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;
const ASSET_CODE_PATTERN = /^[A-Z0-9]{1,12}$/;

/**
 * Validate Stellar public key format
 */
export function isValidStellarPublicKey(value) {
  if (typeof value !== "string") {
    return false;
  }

  const publicKey = value.trim();
  
  if (!STELLAR_PUBLIC_KEY_PATTERN.test(publicKey)) {
    return false;
  }

  // Additional SDK validation if available
  if (typeof StellarSdk.StrKey?.isValidEd25519PublicKey === "function") {
    return StellarSdk.StrKey.isValidEd25519PublicKey(publicKey);
  }

  if (typeof StellarSdk.Keypair?.fromPublicKey === "function") {
    try {
      StellarSdk.Keypair.fromPublicKey(publicKey);
      return true;
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Validate Stellar account ID (alias for public key validation)
 */
export function isValidStellarAccountId(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  return isValidStellarPublicKey(value.trim());
}

/**
 * Validate asset code format
 */
export function isValidAssetCode(value) {
  if (typeof value !== "string") {
    return false;
  }

  return ASSET_CODE_PATTERN.test(value.trim().toUpperCase());
}

/**
 * Validate Stellar memo format based on memo type
 */
export function validateMemo(memo, memoType) {
  if (!memo || !memoType) {
    return { valid: true };
  }

  const normalizedType = memoType.toLowerCase();

  switch (normalizedType) {
    case "text":
      // TEXT memos must be <= 28 bytes UTF-8
      if (Buffer.byteLength(memo, "utf8") > 28) {
        return {
          valid: false,
          error: "TEXT memo must be 28 bytes or less (UTF-8 encoded)",
        };
      }
      return { valid: true };

    case "id":
      // ID memos must be unsigned 64-bit integers (0 to 18446744073709551615)
      if (!/^\d+$/.test(memo)) {
        return {
          valid: false,
          error: "memo must be a valid unsigned 64-bit integer when memo_type is id",
        };
      }
      try {
        const value = BigInt(memo);
        if (value < 0n || value > 18446744073709551615n) {
          return {
            valid: false,
            error: "ID memo must be between 0 and 18446744073709551615",
          };
        }
      } catch {
        return {
          valid: false,
          error: "ID memo must be a valid unsigned 64-bit integer",
        };
      }
      return { valid: true };

    case "hash":
      // HASH memos must be exactly 32 bytes (64 hex characters)
      if (!/^[0-9a-fA-F]{64}$/.test(memo)) {
        return {
          valid: false,
          error: "memo must be a 32-byte hex string (64 characters) when memo_type is hash",
        };
      }
      return { valid: true };

    case "return":
      // RETURN memos can be either 32-byte hex or a valid unsigned 64-bit ID
      const isHex = /^[0-9a-fA-F]{64}$/.test(memo);
      let isValidId = false;

      if (/^\d+$/.test(memo)) {
        try {
          const val = BigInt(memo);
          isValidId = val >= 0n && val <= 18446744073709551615n;
        } catch {
          isValidId = false;
        }
      }

      if (!isHex && !isValidId) {
        return {
          valid: false,
          error: "memo must be a valid unsigned 64-bit integer or a 32-byte hex string (64 characters) when memo_type is return",
        };
      }
      return { valid: true };

    default:
      return {
        valid: false,
        error: `Invalid memo type: ${memoType}. Must be one of: text, id, hash, return`,
      };
  }
}

/**
 * Resolve asset code and issuer to Stellar SDK Asset object
 */
export function resolveAsset(assetCode, assetIssuer) {
  const normalizedAssetCode = String(assetCode || "").trim().toUpperCase();

  if (!normalizedAssetCode) {
    throw new Error("Asset code is required");
  }

  if (!ASSET_CODE_PATTERN.test(normalizedAssetCode)) {
    throw new Error("Asset code must be 1-12 alphanumeric characters");
  }

  // Native XLM
  if (normalizedAssetCode === "XLM") {
    return StellarSdk.Asset.native();
  }

  // Custom asset requires issuer
  if (!assetIssuer) {
    throw new Error("Asset issuer is required for non-native assets");
  }

  const normalizedAssetIssuer = String(assetIssuer).trim();
  if (!isValidStellarPublicKey(normalizedAssetIssuer)) {
    throw new Error("Asset issuer must be a valid Stellar public key");
  }

  return new StellarSdk.Asset(normalizedAssetCode, normalizedAssetIssuer);
}

/**
 * Validate transaction hash format
 */
export function isValidTransactionHash(txHash) {
  if (typeof txHash !== "string" || txHash.length !== 64) {
    return false;
  }
  return /^[0-9a-fA-F]{64}$/.test(txHash);
}

/**
 * Classify how a received amount compares to the expected amount
 * Returns: "exact" | "underpaid" | "overpaid"
 */
export function classifyAmount(expected, received) {
  const expectedNum = Number(expected);
  const receivedNum = Number(received);

  if (Number.isNaN(expectedNum) || Number.isNaN(receivedNum)) return "exact";

  const diff = receivedNum - expectedNum;
  const tolerance = 0.0000001; // 1 stroop
  
  if (Math.abs(diff) <= tolerance) return "exact";
  if (diff < 0) return "underpaid";
  return "overpaid";
}

/**
 * Check if amounts match within tolerance (1 stroop)
 */
export function amountsMatch(expected, received) {
  const expectedNum = Number(expected);
  const receivedNum = Number(received);

  if (Number.isNaN(expectedNum) || Number.isNaN(receivedNum)) {
    return false;
  }

  // Exact match within 1 stroop (0.0000001 XLM)
  return Math.abs(expectedNum - receivedNum) <= 0.0000001;
}