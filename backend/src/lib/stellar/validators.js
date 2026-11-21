/**
 * Stellar Validators - Input validation, payload sanitization, and asset management
 *
 * This module handles all validation and sanitization logic for Stellar-related inputs:
 * - StrKey public key and ledger key validation (Accounts, Muxed, Contracts, Pre-auth Tx, Hashes)
 * - Ed25519 cryptographic signature validation and payload sanitization
 * - Federated address validation and resolution (SEP-0005 / SEP-0002) with SSRF defense
 * - Comprehensive payload sanitization and prototype pollution protection
 * - Automated dead-letter queue (DLQ) recovery and retry logic for asynchronous/transient tasks
 * - Asset code, memo, and transaction hash validation
 */

import crypto from "node:crypto";
import * as StellarSdk from "stellar-sdk";
import { logger } from "../logger.js";
import {
  validatorDuration,
  validatorEvaluationsTotal,
  validatorRejectionsTotal,
  validatorDlqDepth,
  validatorDlqOperationsTotal,
  validatorRegister,
  resetValidatorMetrics,
} from "./validators-metrics.js";

// Re-export metrics and registry for observability scrapers
export {
  validatorRegister,
  resetValidatorMetrics,
  validatorEvaluationsTotal,
  validatorRejectionsTotal,
  validatorDuration,
  validatorDlqDepth,
  validatorDlqOperationsTotal,
};

// ─── Constants & Patterns ───────────────────────────────────────────────────

export const VALIDATOR_ERROR_CODE = "STELLAR_VALIDATION_ERROR";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE32_MAP = Object.freeze(
  Object.fromEntries([...BASE32_ALPHABET].map((char, index) => [char, index]))
);

// StrKey Version Bytes (shifted left by 3 bits per Stellar RFC 4648 / StrKey specification)
export const STRKEY_VERSION_BYTES = Object.freeze({
  ed25519PublicKey: 6 << 3, // 48 -> 'G'
  med25519PublicKey: 12 << 3, // 96 -> 'M'
  ed25519SecretSeed: 18 << 3, // 144 -> 'S'
  preAuthTx: 19 << 3, // 152 -> 'T'
  sha256Hash: 23 << 3, // 184 -> 'X'
  signedPayload: 15 << 3, // 120 -> 'P'
  contract: 2 << 3, // 16 -> 'C'
});

// Format patterns
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;
const MUXED_ACCOUNT_PATTERN = /^M[A-Z2-7]{68}$/;
const CONTRACT_ID_PATTERN = /^C[A-Z2-7]{55}$/;
const PRE_AUTH_TX_PATTERN = /^T[A-Z2-7]{55}$/;
const SHA256_HASH_PATTERN = /^X[A-Z2-7]{55}$/;
const SIGNED_PAYLOAD_PATTERN = /^P[A-Z2-7]{55,}$/;
const SECRET_SEED_PATTERN = /^S[A-Z2-7]{55}$/;
const ASSET_CODE_PATTERN = /^[A-Z0-9]{1,12}$/;
const TRANSACTION_HASH_PATTERN = /^[0-9a-fA-F]{64}$/;

// Ed25519 Group Order L (RFC 8032) to prevent signature malleability
// L = 2^252 + 27742317777372353535851937790883648493
const ED25519_L = BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed");

// Dangerous control characters and null bytes: ASCII 0-31 (except \t, \n, \r), 127, and Unicode separators
const CONTROL_CHARS_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/g;

// Domain validation (RFC 1123)
const DOMAIN_PATTERN = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63}(?<!-))*\.[A-Za-z]{2,}$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.\-+~]{1,64}$/;

// ─── Error Handling ──────────────────────────────────────────────────────────

/**
 * Custom validation error carrying code, offending field, and retryable flag.
 */
export class StellarValidationError extends Error {
  constructor(message, field = null, options = {}) {
    super(message);
    this.name = "StellarValidationError";
    this.field = field;
    this.code = options.code || VALIDATOR_ERROR_CODE;
    this.status = options.status || 400;
    this.statusCode = this.status;
    this.retryable = options.retryable ?? false;
  }
}

/**
 * Safe error formatter that strips sensitive details, credentials, and internal stack traces.
 */
export function formatValidationError(err) {
  if (!err) return { error: "Validation failed" };
  const message = String(err.message || err).replace(
    /\bS[A-Z2-7]{55}\b/g,
    "[REDACTED_SEED]"
  );
  return {
    error: message,
    field: err.field || null,
    code: err.code || VALIDATOR_ERROR_CODE,
  };
}

// ─── StrKey Codec & CRC16 Verification ──────────────────────────────────────

/**
 * Calculate CRC16-XModem checksum (polynomial 0x1021).
 */
export function crc16XModem(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * Decode Base32 string to Buffer without external dependencies.
 */
export function decodeBase32(str) {
  if (typeof str !== "string") return null;
  const bytes = [];
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < str.length; i++) {
    const val = BASE32_MAP[str[i]];
    if (val === undefined) return null;
    buffer = (buffer << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

/**
 * Decode and strictly verify a Stellar StrKey string.
 *
 * Verifies version byte, expected payload length, and CRC16 checksum.
 *
 * @param {string} str
 * @returns {{ type: string, versionByte: number, payload: Buffer, checksum: number }}
 * @throws {StellarValidationError} if invalid
 */
export function decodeStrKey(str) {
  if (typeof str !== "string" || str.trim().length === 0) {
    throw new StellarValidationError("StrKey must be a non-empty string", "strkey");
  }

  const trimmed = str.trim();
  const raw = decodeBase32(trimmed);
  if (!raw || raw.length < 3) {
    throw new StellarValidationError("Invalid Base32 encoding in StrKey", "strkey");
  }

  const versionByte = raw[0];
  const payloadWithVersion = raw.subarray(0, raw.length - 2);
  const expectedChecksum = raw.readUInt16LE(raw.length - 2);
  const calculatedChecksum = crc16XModem(payloadWithVersion);

  if (expectedChecksum !== calculatedChecksum) {
    throw new StellarValidationError("StrKey CRC16 checksum mismatch", "strkey");
  }

  const payload = raw.subarray(1, raw.length - 2);

  // Identify type from version byte
  let type = "unknown";
  for (const [typeName, vByte] of Object.entries(STRKEY_VERSION_BYTES)) {
    if (vByte === versionByte) {
      type = typeName;
      break;
    }
  }

  // Validate standard payload lengths
  if (
    (versionByte === STRKEY_VERSION_BYTES.ed25519PublicKey ||
      versionByte === STRKEY_VERSION_BYTES.ed25519SecretSeed ||
      versionByte === STRKEY_VERSION_BYTES.contract ||
      versionByte === STRKEY_VERSION_BYTES.preAuthTx ||
      versionByte === STRKEY_VERSION_BYTES.sha256Hash) &&
    payload.length !== 32
  ) {
    throw new StellarValidationError(`Invalid payload length for ${type}: expected 32 bytes`, "strkey");
  }

  if (versionByte === STRKEY_VERSION_BYTES.med25519PublicKey && payload.length !== 40) {
    throw new StellarValidationError("Invalid payload length for med25519: expected 40 bytes", "strkey");
  }

  return {
    type,
    versionByte,
    payload,
    checksum: calculatedChecksum,
  };
}

/**
 * Classify a StrKey into its Stellar type name.
 * Returns: 'ed25519_public_key' | 'muxed_account' | 'contract' | 'pre_auth_tx' | 'sha256_hash' | 'signed_payload' | 'secret_seed' | 'invalid'
 */
export function classifyStrKey(value) {
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();

  try {
    const decoded = decodeStrKey(trimmed);
    switch (decoded.versionByte) {
      case STRKEY_VERSION_BYTES.ed25519PublicKey:
        return "ed25519_public_key";
      case STRKEY_VERSION_BYTES.med25519PublicKey:
        return "muxed_account";
      case STRKEY_VERSION_BYTES.contract:
        return "contract";
      case STRKEY_VERSION_BYTES.preAuthTx:
        return "pre_auth_tx";
      case STRKEY_VERSION_BYTES.sha256Hash:
        return "sha256_hash";
      case STRKEY_VERSION_BYTES.signedPayload:
        return "signed_payload";
      case STRKEY_VERSION_BYTES.ed25519SecretSeed:
        return "secret_seed";
      default:
        return "invalid";
    }
  } catch {
    return "invalid";
  }
}

/**
 * Validate and sanitize a StrKey, stripping whitespace and control characters.
 */
export function sanitizeStrKey(value, options = {}) {
  if (typeof value !== "string") {
    throw new StellarValidationError("StrKey must be a string", options.field || "strkey");
  }

  const sanitized = value.trim().toUpperCase();
  if (CONTROL_CHARS_PATTERN.test(sanitized)) {
    throw new StellarValidationError("StrKey contains illegal control characters", options.field || "strkey");
  }

  const classification = classifyStrKey(sanitized);
  if (classification === "invalid") {
    throw new StellarValidationError("Invalid StrKey format or checksum", options.field || "strkey");
  }

  if (options.expectedType && classification !== options.expectedType) {
    throw new StellarValidationError(
      `StrKey type mismatch: expected ${options.expectedType}, received ${classification}`,
      options.field || "strkey"
    );
  }

  if (!options.allowSecret && classification === "secret_seed") {
    throw new StellarValidationError("Secret seeds are not permitted in this context", options.field || "strkey");
  }

  return sanitized;
}

// ─── Public Key & Ledger Key Validators ─────────────────────────────────────

/**
 * Validate Stellar public key format (G... Ed25519 account ID)
 */
export function isValidStellarPublicKey(value) {
  const start = Date.now();
  if (typeof value !== "string") {
    validatorEvaluationsTotal.inc({ operation: "public_key", outcome: "invalid" });
    return false;
  }

  const publicKey = value.trim();

  if (!STELLAR_PUBLIC_KEY_PATTERN.test(publicKey)) {
    validatorEvaluationsTotal.inc({ operation: "public_key", outcome: "invalid" });
    return false;
  }

  // SDK verification if available
  if (typeof StellarSdk.StrKey?.isValidEd25519PublicKey === "function") {
    const valid = StellarSdk.StrKey.isValidEd25519PublicKey(publicKey);
    validatorEvaluationsTotal.inc({ operation: "public_key", outcome: valid ? "valid" : "invalid" });
    validatorDuration.observe({ operation: "public_key" }, (Date.now() - start) / 1000);
    return valid;
  }

  // Pure JS fallback verification
  try {
    const decoded = decodeStrKey(publicKey);
    const valid = decoded.versionByte === STRKEY_VERSION_BYTES.ed25519PublicKey;
    validatorEvaluationsTotal.inc({ operation: "public_key", outcome: valid ? "valid" : "invalid" });
    validatorDuration.observe({ operation: "public_key" }, (Date.now() - start) / 1000);
    return valid;
  } catch {
    validatorEvaluationsTotal.inc({ operation: "public_key", outcome: "invalid" });
    return false;
  }
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
 * Validate Stellar Muxed Account format (M... med25519)
 */
export function isValidMuxedAccount(value) {
  if (typeof value !== "string") return false;
  const muxed = value.trim();
  if (!MUXED_ACCOUNT_PATTERN.test(muxed)) return false;

  if (typeof StellarSdk.StrKey?.isValidMed25519PublicKey === "function") {
    return StellarSdk.StrKey.isValidMed25519PublicKey(muxed);
  }

  try {
    const decoded = decodeStrKey(muxed);
    return decoded.versionByte === STRKEY_VERSION_BYTES.med25519PublicKey;
  } catch {
    return false;
  }
}

export const isValidMed25519PublicKey = isValidMuxedAccount;

/**
 * Validate Stellar Contract ID (C...)
 */
export function isValidContractId(value) {
  if (typeof value !== "string") return false;
  const contract = value.trim();
  if (!CONTRACT_ID_PATTERN.test(contract)) return false;

  if (typeof StellarSdk.StrKey?.isValidContract === "function") {
    return StellarSdk.StrKey.isValidContract(contract);
  }

  try {
    const decoded = decodeStrKey(contract);
    return decoded.versionByte === STRKEY_VERSION_BYTES.contract;
  } catch {
    return false;
  }
}

/**
 * Validate Pre-Auth Transaction Hash StrKey (T...)
 */
export function isValidPreAuthTx(value) {
  if (typeof value !== "string") return false;
  const preAuth = value.trim();
  if (!PRE_AUTH_TX_PATTERN.test(preAuth)) return false;

  try {
    const decoded = decodeStrKey(preAuth);
    return decoded.versionByte === STRKEY_VERSION_BYTES.preAuthTx;
  } catch {
    return false;
  }
}

/**
 * Validate SHA256 Hash Signer StrKey (X...)
 */
export function isValidSha256Hash(value) {
  if (typeof value !== "string") return false;
  const hash = value.trim();
  if (!SHA256_HASH_PATTERN.test(hash)) return false;

  try {
    const decoded = decodeStrKey(hash);
    return decoded.versionByte === STRKEY_VERSION_BYTES.sha256Hash;
  } catch {
    return false;
  }
}

/**
 * Validate Signed Payload StrKey (P...)
 */
export function isValidSignedPayload(value) {
  if (typeof value !== "string") return false;
  const payload = value.trim();
  if (!SIGNED_PAYLOAD_PATTERN.test(payload)) return false;

  if (typeof StellarSdk.StrKey?.isValidSignedPayload === "function") {
    return StellarSdk.StrKey.isValidSignedPayload(payload);
  }

  try {
    const decoded = decodeStrKey(payload);
    return decoded.versionByte === STRKEY_VERSION_BYTES.signedPayload;
  } catch {
    return false;
  }
}

/**
 * Validate Secret Seed (S...)
 * Used to identify and reject secret seeds from public key / ledger key inputs.
 */
export function isValidSecretSeed(value) {
  if (typeof value !== "string") return false;
  const seed = value.trim();
  if (!SECRET_SEED_PATTERN.test(seed)) return false;

  if (typeof StellarSdk.StrKey?.isValidEd25519SecretSeed === "function") {
    return StellarSdk.StrKey.isValidEd25519SecretSeed(seed);
  }

  try {
    const decoded = decodeStrKey(seed);
    return decoded.versionByte === STRKEY_VERSION_BYTES.ed25519SecretSeed;
  } catch {
    return false;
  }
}

/**
 * Comprehensive ledger key validator.
 *
 * Security rule: Secret seeds ('S...') are NEVER valid ledger keys and are rejected.
 *
 * @param {string} value - The ledger key to validate
 * @param {string} [expectedType] - Optional specific type: 'account' | 'muxed_account' | 'contract' | 'pre_auth_tx' | 'sha256_hash'
 * @returns {boolean}
 */
export function isValidLedgerKey(value, expectedType = null) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();

  // Explicit rejection of secret seeds
  if (trimmed.startsWith("S") || isValidSecretSeed(trimmed)) {
    logger?.warn?.({ key: "[REDACTED_SEED]" }, "Rejected secret seed supplied as ledger key");
    return false;
  }

  if (expectedType) {
    switch (expectedType.toLowerCase()) {
      case "account":
      case "public_key":
      case "ed25519":
        return isValidStellarPublicKey(trimmed);
      case "muxed":
      case "muxed_account":
      case "med25519":
        return isValidMuxedAccount(trimmed);
      case "contract":
        return isValidContractId(trimmed);
      case "pre_auth_tx":
        return isValidPreAuthTx(trimmed);
      case "sha256_hash":
        return isValidSha256Hash(trimmed);
      default:
        return false;
    }
  }

  // Accept any valid public ledger key type
  return (
    isValidStellarPublicKey(trimmed) ||
    isValidMuxedAccount(trimmed) ||
    isValidContractId(trimmed) ||
    isValidPreAuthTx(trimmed) ||
    isValidSha256Hash(trimmed)
  );
}

// ─── Ed25519 Signature Validator ───────────────────────────────────────────

/**
 * Read a little-endian unsigned BigInt from a buffer slice.
 */
function readLittleEndianBigInt(buf, offset, length) {
  let result = 0n;
  for (let i = length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(buf[offset + i]);
  }
  return result;
}

/**
 * Validate Ed25519 signature format and canonical scalar bounds (RFC 8032).
 *
 * Accepts 64-byte Buffer/Uint8Array, 128-hex character string, or base64 string.
 * Enforces S < L to prevent signature malleability.
 */
export function isValidEd25519Signature(signature) {
  const start = Date.now();
  let sigBuf = null;

  try {
    if (Buffer.isBuffer(signature) || signature instanceof Uint8Array) {
      if (signature.length === 64) {
        sigBuf = Buffer.from(signature);
      }
    } else if (typeof signature === "string") {
      const trimmed = signature.trim();
      if (/^[0-9a-fA-F]{128}$/.test(trimmed)) {
        sigBuf = Buffer.from(trimmed, "hex");
      } else if (/^[A-Za-z0-9+/]{86}==$/.test(trimmed) || trimmed.length === 88) {
        const decoded = Buffer.from(trimmed, "base64");
        if (decoded.length === 64) {
          sigBuf = decoded;
        }
      }
    }

    if (!sigBuf || sigBuf.length !== 64) {
      validatorEvaluationsTotal.inc({ operation: "signature_format", outcome: "invalid" });
      return false;
    }

    // Canonical S-scalar upper bound check: S < L
    const s = readLittleEndianBigInt(sigBuf, 32, 32);
    if (s >= ED25519_L) {
      validatorRejectionsTotal.inc({ operation: "signature_format", reason: "malleable_scalar" });
      validatorEvaluationsTotal.inc({ operation: "signature_format", outcome: "invalid" });
      return false;
    }

    validatorEvaluationsTotal.inc({ operation: "signature_format", outcome: "valid" });
    validatorDuration.observe({ operation: "signature_format" }, (Date.now() - start) / 1000);
    return true;
  } catch {
    validatorEvaluationsTotal.inc({ operation: "signature_format", outcome: "invalid" });
    return false;
  }
}

/**
 * Sanitize and normalize signature into a clean 64-byte Buffer.
 */
export function sanitizeSignature(signature) {
  if (!signature) {
    throw new StellarValidationError("Signature is required", "signature");
  }

  let sigBuf = null;
  if (Buffer.isBuffer(signature) || signature instanceof Uint8Array) {
    sigBuf = Buffer.from(signature);
  } else if (typeof signature === "string") {
    const trimmed = signature.trim();
    if (/^[0-9a-fA-F]{128}$/.test(trimmed)) {
      sigBuf = Buffer.from(trimmed, "hex");
    } else {
      const decoded = Buffer.from(trimmed, "base64");
      if (decoded.length === 64) {
        sigBuf = decoded;
      }
    }
  }

  if (!sigBuf || sigBuf.length !== 64 || !isValidEd25519Signature(sigBuf)) {
    throw new StellarValidationError("Invalid Ed25519 signature payload or non-canonical scalar", "signature");
  }

  return sigBuf;
}

/**
 * Verify Ed25519 signature cryptographically against a Stellar public key.
 *
 * @param {string} publicKey - Stellar public key ('G...')
 * @param {Buffer|string} data - Payload data that was signed
 * @param {Buffer|string} signature - 64-byte Ed25519 signature
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyEd25519Signature(publicKey, data, signature) {
  const start = Date.now();

  try {
    if (!isValidStellarPublicKey(publicKey)) {
      validatorRejectionsTotal.inc({ operation: "signature_verify", reason: "invalid_public_key" });
      return { valid: false, reason: "Invalid Stellar public key" };
    }

    if (!data || (typeof data !== "string" && !Buffer.isBuffer(data) && !(data instanceof Uint8Array))) {
      validatorRejectionsTotal.inc({ operation: "signature_verify", reason: "invalid_data" });
      return { valid: false, reason: "Data must be a non-empty string or buffer" };
    }

    const sigBuf = sanitizeSignature(signature);
    const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");

    const keypair = StellarSdk.Keypair.fromPublicKey(publicKey.trim());
    const valid = keypair.verify(dataBuf, sigBuf);

    validatorEvaluationsTotal.inc({
      operation: "signature_verify",
      outcome: valid ? "valid" : "invalid",
    });
    validatorDuration.observe({ operation: "signature_verify" }, (Date.now() - start) / 1000);

    if (!valid) {
      return { valid: false, reason: "Cryptographic signature verification failed" };
    }

    return { valid: true };
  } catch (err) {
    validatorEvaluationsTotal.inc({ operation: "signature_verify", outcome: "error" });
    return { valid: false, reason: err.message || "Signature verification error" };
  }
}

// ─── Federated Address Resolver & SSRF Defense ──────────────────────────────

/**
 * Validate federated address format (username*domain.com) with SSRF checks.
 */
export function isValidFederatedAddress(value) {
  if (typeof value !== "string" || value.length > 256) {
    return false;
  }

  const trimmed = value.trim();
  const parts = trimmed.split("*");
  if (parts.length !== 2) {
    return false;
  }

  const [username, domain] = parts;
  if (!USERNAME_PATTERN.test(username)) {
    return false;
  }

  // Domain syntax check
  if (!DOMAIN_PATTERN.test(domain)) {
    return false;
  }

  // Anti-SSRF: Reject IPv4 and IPv6 literals
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(domain) || domain.includes(":")) {
    return false;
  }

  // Anti-SSRF: Reject localhost and private domain suffixes
  const lowerDomain = domain.toLowerCase();
  const blockedSuffixes = [
    "localhost",
    ".localhost",
    ".local",
    ".internal",
    ".arpa",
    ".onion",
    ".invalid",
    ".test",
    ".corp",
    ".home",
    ".lan",
  ];
  if (blockedSuffixes.some((suffix) => lowerDomain === suffix || lowerDomain.endsWith(suffix))) {
    return false;
  }

  return true;
}

/**
 * Sanitize a federated address and return canonical structure.
 */
export function sanitizeFederatedAddress(value) {
  if (!isValidFederatedAddress(value)) {
    throw new StellarValidationError(
      "Invalid federated address format or disallowed domain (SSRF protection)",
      "federated_address"
    );
  }

  const [username, domain] = value.trim().split("*");
  const canonicalDomain = domain.toLowerCase();
  return {
    address: `${username}*${canonicalDomain}`,
    username,
    domain: canonicalDomain,
  };
}

/**
 * Resolve a federated Stellar address (SEP-0005) with retry logic and SSRF protection.
 *
 * @param {string} federatedAddress - e.g. "alice*example.com"
 * @param {object} [options]
 * @param {Function} [options.fetchFn] - Injectable fetch
 * @param {number} [options.timeoutMs=5000] - Request timeout
 * @param {number} [options.maxRetries=2] - Retries for transient failures
 * @param {number} [options.retryDelayMs=200] - Base retry delay
 * @param {boolean} [options.allowHttp=false] - For local test environments
 * @param {boolean} [options.allowLocalhost=false] - For local test environments
 * @param {ValidatorDeadLetterQueue} [options.dlq] - Dead-letter queue
 * @returns {Promise<{ account_id: string, memo?: string, memo_type?: string }>}
 */
export async function resolveFederatedAddress(federatedAddress, options = {}) {
  const start = Date.now();
  const {
    fetchFn = globalThis.fetch,
    timeoutMs = 5000,
    maxRetries = 2,
    retryDelayMs = 200,
    allowHttp = false,
    allowLocalhost = false,
    dlq = null,
  } = options;

  let parsed;
  try {
    parsed = sanitizeFederatedAddress(federatedAddress);
  } catch (err) {
    validatorRejectionsTotal.inc({ operation: "federation_resolve", reason: "invalid_syntax" });
    throw err;
  }

  const { address, domain } = parsed;

  const executeResolution = async () => {
    // Step 1: Fetch stellar.toml
    const protocol = allowHttp ? "http" : "https";
    const tomlUrl = `${protocol}://${domain}/.well-known/stellar.toml`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let tomlText;
    try {
      const res = await fetchFn(tomlUrl, { signal: controller.signal });
      if (!res.ok) {
        const error = new Error(`Failed to fetch stellar.toml: HTTP ${res.status}`);
        error.status = res.status;
        error.retryable = res.status >= 500 || res.status === 429;
        throw error;
      }
      tomlText = await res.text();
    } finally {
      clearTimeout(timer);
    }

    // Step 2: Extract FEDERATION_SERVER
    const fedServerMatch = tomlText.match(/FEDERATION_SERVER\s*=\s*["']([^"']+)["']/i);
    if (!fedServerMatch || !fedServerMatch[1]) {
      const error = new StellarValidationError("stellar.toml missing FEDERATION_SERVER", "federation_server");
      error.retryable = false;
      throw error;
    }

    const fedServerUrlStr = fedServerMatch[1].trim();
    let fedUrl;
    try {
      fedUrl = new URL(fedServerUrlStr);
    } catch {
      const error = new StellarValidationError("Invalid FEDERATION_SERVER URL", "federation_server");
      error.retryable = false;
      throw error;
    }

    // Validate FEDERATION_SERVER against SSRF
    if (fedUrl.protocol !== "https:" && !(allowHttp && fedUrl.protocol === "http:")) {
      const error = new StellarValidationError("FEDERATION_SERVER must use HTTPS", "federation_server");
      error.retryable = false;
      throw error;
    }

    if (!allowLocalhost) {
      const host = fedUrl.hostname.toLowerCase();
      if (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ||
        host.includes(":")
      ) {
        const error = new StellarValidationError("FEDERATION_SERVER targets disallowed host (SSRF protection)", "federation_server");
        error.retryable = false;
        throw error;
      }
    }

    // Step 3: Query federation server
    const queryUrl = new URL(fedUrl.toString());
    queryUrl.searchParams.set("type", "name");
    queryUrl.searchParams.set("q", address);

    const queryController = new AbortController();
    const queryTimer = setTimeout(() => queryController.abort(), timeoutMs);

    let data;
    try {
      const res = await fetchFn(queryUrl.toString(), { signal: queryController.signal });
      if (!res.ok) {
        const error = new Error(`Federation server responded with HTTP ${res.status}`);
        error.status = res.status;
        error.retryable = res.status >= 500 || res.status === 429;
        throw error;
      }
      data = await res.json();
    } finally {
      clearTimeout(queryTimer);
    }

    // Step 4: Sanitize returned payload
    if (!data || typeof data !== "object") {
      throw new StellarValidationError("Invalid JSON response from federation server", "federation_response");
    }

    const accountId = String(data.account_id || "").trim();
    if (!isValidStellarPublicKey(accountId)) {
      throw new StellarValidationError("Federation response contains invalid account_id", "account_id");
    }

    const result = { account_id: accountId };

    if (data.memo) {
      const memoType = String(data.memo_type || "text").trim();
      const memoValidation = validateMemo(String(data.memo), memoType);
      if (!memoValidation.valid) {
        throw new StellarValidationError(`Federation response memo invalid: ${memoValidation.error}`, "memo");
      }
      result.memo = String(data.memo);
      result.memo_type = memoType;
    }

    return result;
  };

  // Execution with retry logic
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await executeResolution();
      validatorEvaluationsTotal.inc({ operation: "federation_resolve", outcome: "valid" });
      validatorDuration.observe({ operation: "federation_resolve" }, (Date.now() - start) / 1000);
      return result;
    } catch (err) {
      lastError = err;
      if (!err.retryable || attempt === maxRetries) {
        break;
      }
      const backoff = retryDelayMs * Math.pow(2, attempt) + Math.random() * 50;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  // On failure: Push to DLQ if supplied or configured
  if (dlq) {
    dlq.push(
      { operation: "federation_resolve", address },
      lastError,
      maxRetries
    );
  }

  validatorEvaluationsTotal.inc({ operation: "federation_resolve", outcome: "error" });
  throw lastError;
}

// ─── Payload Sanitization & Anti-Tampering ──────────────────────────────────

/**
 * Deep sanitization for incoming request payloads:
 * - Drops prototype pollution attempts (__proto__, constructor, prototype)
 * - Strips null bytes (\0) and control characters
 * - Normalizes Unicode strings (NFKC)
 * - Trims whitespace
 * - Enforces depth limits to prevent recursion attacks
 */
export function sanitizePayload(payload, schema = null, options = {}) {
  const maxDepth = options.maxDepth || 10;
  const visited = new WeakSet();

  function sanitizeInternal(value, depth = 0) {
    if (depth > maxDepth) {
      throw new StellarValidationError("Payload exceeds maximum allowable nesting depth", "payload");
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === "string") {
      let sanitized = value.normalize("NFKC").trim();
      if (CONTROL_CHARS_PATTERN.test(sanitized)) {
        sanitized = sanitized.replace(CONTROL_CHARS_PATTERN, "");
      }
      return sanitized;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      return Buffer.from(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => sanitizeInternal(item, depth + 1));
    }

    if (typeof value === "object") {
      if (visited.has(value)) {
        throw new StellarValidationError("Circular reference detected in payload", "payload");
      }
      visited.add(value);

      const cleanObj = Object.create(null);

      for (const key of Object.keys(value)) {
        // Prototype pollution defense
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          continue;
        }

        const cleanKey = key.trim().replace(CONTROL_CHARS_PATTERN, "");
        if (!cleanKey) continue;

        cleanObj[cleanKey] = sanitizeInternal(value[key], depth + 1);
      }

      // Schema allow-list filtering if schema provided
      if (schema && typeof schema === "object") {
        const filteredObj = Object.create(null);
        for (const [expectedKey, rules] of Object.entries(schema)) {
          if (cleanObj[expectedKey] !== undefined) {
            filteredObj[expectedKey] = cleanObj[expectedKey];
          } else if (rules.required) {
            throw new StellarValidationError(`Missing required payload field: ${expectedKey}`, expectedKey);
          }
        }
        return filteredObj;
      }

      return cleanObj;
    }

    return null;
  }

  return sanitizeInternal(payload);
}

// ─── Automated Dead-Letter Queue (DLQ) Recovery & Retry Logic ───────────────

/**
 * In-memory dead-letter queue with poison-pill detection, exponential backoff,
 * capacity limits, and Prometheus instrumentation.
 */
export class ValidatorDeadLetterQueue {
  constructor(options = {}) {
    this.maxCapacity = options.maxCapacity || 1000;
    this._entries = [];
  }

  /**
   * Enqueue a failed validation or resolution task onto the DLQ.
   */
  push(item, error, attempts = 0, context = {}) {
    // Drop oldest entry if capacity exceeded to prevent memory exhaustion
    if (this._entries.length >= this.maxCapacity) {
      const dropped = this._entries.shift();
      logger?.warn?.({ droppedId: dropped?.id }, "Validator DLQ capacity reached; evicted oldest entry");
    }

    let sanitizedItem;
    try {
      sanitizedItem = sanitizePayload(item);
    } catch {
      sanitizedItem = { raw: "[UNSANITIZABLE_PAYLOAD]" };
    }

    const entry = {
      id: crypto.randomUUID(),
      item: sanitizedItem,
      context: sanitizePayload(context),
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: error?.code || VALIDATOR_ERROR_CODE,
      },
      attempts: Math.max(0, Number(attempts) || 0),
      status: "pending", // 'pending' | 'recovered' | 'exhausted'
      failedAt: new Date().toISOString(),
      nextRetryAt: Date.now() + Math.min(60000, 1000 * Math.pow(2, attempts)),
    };

    this._entries.push(entry);
    validatorDlqDepth.set(this._entries.length);
    validatorDlqOperationsTotal.inc({ action: "push", status: "success" });

    logger?.info?.(
      { dlqId: entry.id, attempts: entry.attempts, error: entry.error.message },
      "Validator DLQ: Enqueued failed task"
    );

    return entry;
  }

  /**
   * Return a shallow copy of all entries.
   */
  getAll() {
    return [...this._entries];
  }

  /**
   * Return all currently pending entries.
   */
  getPending() {
    return this._entries.filter((entry) => entry.status === "pending");
  }

  /**
   * Return all exhausted entries (poison pills).
   */
  getExhausted() {
    return this._entries.filter((entry) => entry.status === "exhausted");
  }

  /**
   * Remove and return the oldest entry.
   */
  shift() {
    const entry = this._entries.shift() || null;
    validatorDlqDepth.set(this._entries.length);
    return entry;
  }

  /**
   * Peek at oldest entry without removing it.
   */
  peek() {
    return this._entries[0] || null;
  }

  /**
   * Clear the entire queue and reset metrics.
   */
  clear() {
    this._entries = [];
    validatorDlqDepth.set(0);
    validatorDlqOperationsTotal.inc({ action: "clear", status: "success" });
  }

  /** Current number of entries in the queue. */
  get size() {
    return this._entries.length;
  }

  /** Stats summary */
  get stats() {
    let pending = 0;
    let exhausted = 0;
    for (const entry of this._entries) {
      if (entry.status === "pending") pending++;
      if (entry.status === "exhausted") exhausted++;
    }
    return {
      total: this._entries.length,
      pending,
      exhausted,
    };
  }
}

// Global module singleton instance
export const validatorDlq = new ValidatorDeadLetterQueue();

/**
 * Recover eligible pending items from the Dead-Letter Queue.
 *
 * Implements exponential backoff, retry management, and poison pill isolation.
 *
 * @param {object} opts
 * @param {ValidatorDeadLetterQueue} [opts.dlq=validatorDlq]
 * @param {Function} opts.handler - Async callback to process recovery for an entry
 * @param {number} [opts.maxBatchSize=10]
 * @param {number} [opts.maxDlqRetries=3]
 * @param {number} [opts.baseDelayMs=1000]
 * @param {Function} [opts.now] - Injectable clock
 * @returns {Promise<{ recovered: number, failed: number, exhausted: number }>}
 */
export async function recoverDeadLetterQueue(opts = {}) {
  const {
    dlq = validatorDlq,
    handler,
    maxBatchSize = 10,
    maxDlqRetries = 3,
    baseDelayMs = 1000,
    now = () => Date.now(),
  } = opts;

  let recovered = 0;
  let failed = 0;
  let exhausted = 0;
  const currentTime = now();

  // Pick pending entries eligible for retry
  const eligibleEntries = [];
  for (const entry of dlq.getAll()) {
    if (entry.status === "pending" && entry.nextRetryAt <= currentTime) {
      eligibleEntries.push(entry);
      if (eligibleEntries.length >= maxBatchSize) break;
    }
  }

  for (const entry of eligibleEntries) {
    try {
      if (handler) {
        await handler(entry);
      }

      // Success: mark recovered and remove from queue
      entry.status = "recovered";
      const index = dlq._entries.indexOf(entry);
      if (index !== -1) {
        dlq._entries.splice(index, 1);
      }

      validatorDlqOperationsTotal.inc({ action: "recover", status: "success" });
      recovered++;
      logger?.info?.({ dlqId: entry.id }, "Validator DLQ: Entry successfully recovered");
    } catch (err) {
      entry.attempts++;
      entry.lastFailedAt = currentTime;
      entry.error = {
        message: err.message || String(err),
        code: err.code || VALIDATOR_ERROR_CODE,
      };

      if (entry.attempts >= maxDlqRetries) {
        // Exceeded retries: mark as exhausted poison pill
        entry.status = "exhausted";
        validatorDlqOperationsTotal.inc({ action: "exhaust", status: "poison_pill" });
        exhausted++;
        logger?.error?.(
          { dlqId: entry.id, attempts: entry.attempts, error: entry.error.message },
          "Validator DLQ: Entry exceeded max retries; segregated as poison pill"
        );
      } else {
        // Re-schedule with jittered exponential backoff
        const backoff = Math.min(60000, baseDelayMs * Math.pow(2, entry.attempts));
        const jitter = Math.floor(Math.random() * (backoff * 0.1));
        entry.nextRetryAt = currentTime + backoff + jitter;
        validatorDlqOperationsTotal.inc({ action: "retry", status: "failure" });
        failed++;
        logger?.warn?.(
          { dlqId: entry.id, attempts: entry.attempts, nextRetryAt: entry.nextRetryAt },
          "Validator DLQ: Retry failed; re-scheduled with backoff"
        );
      }
    }
  }

  validatorDlqDepth.set(dlq.size);
  return { recovered, failed, exhausted };
}

/**
 * Convenient wrapper to recover items from the default validator DLQ.
 */
export async function recoverValidatorDeadLetterQueue(opts = {}) {
  return recoverDeadLetterQueue({ dlq: validatorDlq, ...opts });
}

/**
 * Get stats from the default validator DLQ.
 */
export function getDeadLetterQueueStats() {
  return validatorDlq.stats;
}

/**
 * Clear the default validator DLQ.
 */
export function clearDeadLetterQueue() {
  validatorDlq.clear();
}

/**
 * Enqueue an item into the default validator DLQ.
 */
export function enqueueValidationDeadLetter(item, error, attempts = 0, context = {}) {
  return validatorDlq.push(item, error, attempts, context);
}

// ─── Asset, Memo & Transaction Validators (Backward Compatible) ─────────────

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

  if (typeof memo !== "string") {
    return { valid: false, error: "Memo must be a string" };
  }
  if (typeof memoType !== "string") {
    return { valid: false, error: "Memo type must be a string" };
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

    case "return": {
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
    }

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
 * Validate transaction hash format (64 hex characters)
 */
export function isValidTransactionHash(txHash) {
  if (typeof txHash !== "string" || txHash.length !== 64) {
    return false;
  }
  return TRANSACTION_HASH_PATTERN.test(txHash);
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
  if (isWithinAmountTolerance(expectedNum, receivedNum)) return "exact";
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

  return isWithinAmountTolerance(expectedNum, receivedNum);
}

function isWithinAmountTolerance(expected, received) {
  const roundingAllowance =
    Number.EPSILON * Math.max(1, Math.abs(expected), Math.abs(received));
  return Math.abs(expected - received) <= 0.0000001 + roundingAllowance;
}
