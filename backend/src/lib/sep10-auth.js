import jwt from "jsonwebtoken";
import * as StellarSdk from "stellar-sdk";
import { randomBytes } from "node:crypto";
import { logger } from "./logger.js";

const DEFAULT_HOME_DOMAIN = "localhost";

const NETWORK = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
const NETWORK_PASSPHRASE =
  NETWORK === "public"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

export const CHALLENGE_EXPIRES_IN = 300;
export const MAX_CHALLENGE_XDR_BYTES = 8192;
export const MIN_CHALLENGE_NONCE_LENGTH = 16;
export const SESSION_TOKEN_ALGORITHM = "HS256";

export const NONCE_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_MAX_NONCE_CACHE = 10_000;
const STORE_RETRY_DELAYS_MS = [100, 300];

// nonce -> epoch ms after which the challenge can no longer verify (#1292).
// Entries only need to outlive their challenge's maxTime; after that the
// time-bound check rejects the challenge on its own.
const _usedNonces = new Map();
let _nonceCleanupTimer = null;

function getMaxNonceCache() {
  const configured = parseInt(process.env.SEP10_NONCE_CACHE_MAX ?? "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_NONCE_CACHE;
}

/**
 * Structured error for SEP-10 route/store failures (#587).
 */
export class Sep10AuthError extends Error {
  constructor(code, message, httpStatus = 400, { retryable = false, cause } = {}) {
    super(message);
    this.name = "Sep10AuthError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

export function getHomeDomain() {
  const configured = process.env.HOME_DOMAIN;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured.trim();
  }
  return DEFAULT_HOME_DOMAIN;
}

export function getNetworkPassphrase() {
  return NETWORK_PASSPHRASE;
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required for SEP-10 authentication");
  }
  return secret;
}

function stopNonceCleanup() {
  if (!_nonceCleanupTimer) return;
  clearInterval(_nonceCleanupTimer);
  _nonceCleanupTimer = null;
}

/**
 * Drop nonces whose challenges have expired (#1292).
 * @returns {number} how many entries were removed
 */
export function pruneExpiredNonces(nowMs = Date.now()) {
  let removed = 0;
  for (const [nonce, expiresAtMs] of _usedNonces) {
    if (expiresAtMs <= nowMs) {
      _usedNonces.delete(nonce);
      removed += 1;
    }
  }
  if (_usedNonces.size === 0) stopNonceCleanup();
  return removed;
}

function startNonceCleanup() {
  if (_nonceCleanupTimer) return;
  _nonceCleanupTimer = setInterval(() => pruneExpiredNonces(), NONCE_SWEEP_INTERVAL_MS);
  if (_nonceCleanupTimer.unref) _nonceCleanupTimer.unref();
}

/**
 * Keep the cache under its hard cap. Expired entries go first; if the cache
 * is still full of live nonces, the oldest are evicted (Map preserves
 * insertion order) rather than wiping the whole cache, which previously
 * discarded every live nonce at once and reopened replay for all of them.
 */
function enforceNonceCacheLimit() {
  const max = getMaxNonceCache();
  if (_usedNonces.size < max) return;

  pruneExpiredNonces();

  let evicted = 0;
  for (const nonce of _usedNonces.keys()) {
    if (_usedNonces.size < max) break;
    _usedNonces.delete(nonce);
    evicted += 1;
  }

  if (evicted > 0) {
    logger.warn({ evicted, max }, "sep10 nonce cache full; evicted oldest live nonces");
  }
}

/**
 * Atomically claim a challenge nonce (#1295).
 * The check and the insert run in the same synchronous tick, so two concurrent
 * verify requests for the same challenge can never both succeed.
 * @param {string} nonce
 * @param {number} [expiresAtSec] challenge maxTime; the entry is kept until then
 * @returns {boolean} true if the nonce was claimed, false if already used.
 */
export function consumeChallengeNonce(nonce, expiresAtSec) {
  const nowMs = Date.now();
  const existing = _usedNonces.get(nonce);
  if (existing !== undefined && existing > nowMs) return false;

  enforceNonceCacheLimit();

  const expiresAtMs =
    Number.isFinite(expiresAtSec) && expiresAtSec > 0
      ? (expiresAtSec + 1) * 1000
      : nowMs + CHALLENGE_EXPIRES_IN * 1000;
  _usedNonces.set(nonce, expiresAtMs);
  startNonceCleanup();
  return true;
}

/**
 * Give a claimed nonce back when no session token was issued for it, e.g. the
 * merchant store was temporarily unavailable and the client was told to retry.
 */
export function releaseChallengeNonce(nonce) {
  if (typeof nonce !== "string") return;
  _usedNonces.delete(nonce);
  if (_usedNonces.size === 0) stopNonceCleanup();
}

export function _resetNonceCacheForTests() {
  _usedNonces.clear();
  stopNonceCleanup();
}

export function _getNonceCacheStatsForTests() {
  return { size: _usedNonces.size, sweeping: _nonceCleanupTimer !== null };
}

function getServerSigningKey() {
  return process.env.SEP10_SERVER_SIGNING_KEY;
}

/**
 * Normalise a thrown value into an Error (#1293).
 * A store client rejecting with `null`/`undefined` would otherwise be rethrown
 * as-is, and `next(undefined)` makes Express treat the request as successful
 * and leave it hanging.
 */
function toError(value, label) {
  if (value instanceof Error) return value;
  const message =
    value && typeof value.message === "string"
      ? value.message
      : `${label} failed with a non-error rejection`;
  const error = new Error(message);
  if (value && typeof value === "object") {
    if (value.code !== undefined) error.code = value.code;
    if (value.status !== undefined) error.status = value.status;
  }
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableSep10StoreError(error) {
  if (!error) return false;
  const message = String(error.message || "");
  return (
    /fetch failed|timeout|ECONNRESET|ETIMEDOUT|502|503|504|temporarily unavailable/i.test(
      message,
    ) || error.code === "PGRST000"
  );
}

/**
 * Retry transient store failures before surfacing a retryable 503 (#587).
 */
export async function withSep10StoreRecovery(fn, label) {
  let lastError = null;

  for (let attempt = 0; attempt <= STORE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fn();
    } catch (thrown) {
      const err = toError(thrown, label);
      lastError = err;
      if (!isRetryableSep10StoreError(err) || attempt === STORE_RETRY_DELAYS_MS.length) {
        if (isRetryableSep10StoreError(err)) {
          logger.warn({ label, attempt }, "sep10 store temporarily unavailable");
          throw new Sep10AuthError(
            "SERVICE_UNAVAILABLE",
            "Authentication store temporarily unavailable, please retry",
            503,
            { retryable: true, cause: err },
          );
        }
        throw err;
      }
      await sleep(STORE_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError;
}

/**
 * Guard against oversized or malformed challenge XDR before parsing (#588).
 */
export function validateChallengeXdr(challengeXdr) {
  if (typeof challengeXdr !== "string" || challengeXdr.trim().length === 0) {
    return { valid: false, error: "Missing challenge transaction" };
  }

  const trimmed = challengeXdr.trim();
  if (trimmed.length > MAX_CHALLENGE_XDR_BYTES) {
    return { valid: false, error: "Challenge transaction exceeds maximum size" };
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    return { valid: false, error: "Invalid challenge transaction encoding" };
  }

  return { valid: true };
}

export function generateChallenge(clientAccountId, homeDomain = getHomeDomain()) {
  const serverSigningKey = getServerSigningKey();

  if (!serverSigningKey) {
    throw new Error("SEP-0010 server signing key not configured");
  }

  try {
    StellarSdk.Keypair.fromPublicKey(clientAccountId);
  } catch {
    throw new Error("Invalid client Stellar account");
  }

  const serverKeypair = StellarSdk.Keypair.fromSecret(serverSigningKey);
  const nonce = randomBytes(32).toString("base64");

  const now = Math.floor(Date.now() / 1000);
  const minTime = now.toString();
  const maxTime = (now + CHALLENGE_EXPIRES_IN).toString();

  const account = new StellarSdk.Account(serverKeypair.publicKey(), "-1");

  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
    timebounds: {
      minTime,
      maxTime,
    },
  })
    .addOperation(
      StellarSdk.Operation.manageData({
        name: `${homeDomain} auth`,
        value: nonce,
        source: clientAccountId,
      }),
    )
    .build();

  transaction.sign(serverKeypair);

  return transaction.toXDR();
}

/**
 * Verify a signed SEP-0010 challenge transaction.
 * On success the challenge nonce is consumed and returned so the caller can
 * release it if it fails to issue a session token.
 * @returns {{ valid: boolean, nonce?: string, error?: string, code?: string }}
 */
export function verifyChallenge(challengeXdr, clientAccountId, homeDomain = getHomeDomain()) {
  const serverSigningKey = getServerSigningKey();

  if (!serverSigningKey) {
    return { valid: false, error: "SEP-0010 not configured", code: "NOT_CONFIGURED" };
  }

  const xdrValidation = validateChallengeXdr(challengeXdr);
  if (!xdrValidation.valid) {
    return { valid: false, error: xdrValidation.error, code: "INVALID_XDR" };
  }

  try {
    StellarSdk.Keypair.fromPublicKey(clientAccountId);
  } catch {
    return { valid: false, error: "Invalid client account", code: "INVALID_ACCOUNT" };
  }

  try {
    const serverKeypair = StellarSdk.Keypair.fromSecret(serverSigningKey);
    const transaction = new StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      NETWORK_PASSPHRASE,
    );

    // A FeeBumpTransaction proxies `operations` but has no `timeBounds`, which
    // previously crashed the time-bound destructuring below (#1293).
    if (!(transaction instanceof StellarSdk.Transaction)) {
      return { valid: false, error: "Invalid challenge structure", code: "INVALID_STRUCTURE" };
    }

    // SEP-10: the challenge must be sourced from the server account with
    // sequence number 0 so it can never be submitted to the network (#1294).
    if (transaction.source !== serverKeypair.publicKey() || transaction.sequence !== "0") {
      return {
        valid: false,
        error: "Challenge was not issued by this server",
        code: "INVALID_STRUCTURE",
      };
    }

    if (!Array.isArray(transaction.operations) || transaction.operations.length !== 1) {
      return { valid: false, error: "Invalid challenge structure", code: "INVALID_STRUCTURE" };
    }

    const operation = transaction.operations[0];
    if (!operation || operation.type !== "manageData") {
      return { valid: false, error: "Invalid operation type", code: "INVALID_OPERATION" };
    }

    if (operation.source !== clientAccountId) {
      return { valid: false, error: "Client account mismatch", code: "ACCOUNT_MISMATCH" };
    }

    const expectedName = `${homeDomain} auth`;
    if (operation.name !== expectedName) {
      return { valid: false, error: "Challenge data name mismatch", code: "HOME_DOMAIN_MISMATCH" };
    }

    const valueStr =
      typeof operation.value === "string" ? operation.value : operation.value?.toString();
    if (typeof valueStr !== "string" || valueStr.length < MIN_CHALLENGE_NONCE_LENGTH) {
      return { valid: false, error: "Invalid challenge nonce", code: "INVALID_NONCE" };
    }

    if (!transaction.timeBounds) {
      return { valid: false, error: "Challenge missing time bounds", code: "INVALID_TIME_BOUNDS" };
    }

    const now = Math.floor(Date.now() / 1000);
    const minTime = parseInt(transaction.timeBounds.minTime, 10);
    const maxTime = parseInt(transaction.timeBounds.maxTime, 10);

    if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) {
      return { valid: false, error: "Challenge missing time bounds", code: "INVALID_TIME_BOUNDS" };
    }

    // Reject unbounded (maxTime 0) or overly long windows, which would keep a
    // leaked signed challenge usable far beyond CHALLENGE_EXPIRES_IN (#1294).
    if (maxTime === 0 || maxTime - minTime > CHALLENGE_EXPIRES_IN) {
      return { valid: false, error: "Invalid challenge time bounds", code: "INVALID_TIME_BOUNDS" };
    }

    if (now < minTime || now > maxTime) {
      return { valid: false, error: "Challenge expired", code: "CHALLENGE_EXPIRED" };
    }

    const txHash = transaction.hash();
    const signatures = Array.isArray(transaction.signatures) ? transaction.signatures : [];

    const signedBy = (keypair, sig) => {
      try {
        return keypair.verify(txHash, sig.signature());
      } catch {
        return false;
      }
    };

    const serverSigned = signatures.some((sig) => signedBy(serverKeypair, sig));

    if (!serverSigned) {
      return { valid: false, error: "Server signature missing", code: "SERVER_SIGNATURE_MISSING" };
    }

    const clientKeypair = StellarSdk.Keypair.fromPublicKey(clientAccountId);
    const clientSigned = signatures.some((sig) => signedBy(clientKeypair, sig));

    if (!clientSigned) {
      return {
        valid: false,
        error: "Client signature missing or invalid",
        code: "CLIENT_SIGNATURE_INVALID",
      };
    }

    // SEP-10: no signatures other than the server's and the client's (#1294).
    const unrecognized = signatures.some(
      (sig) => !signedBy(serverKeypair, sig) && !signedBy(clientKeypair, sig),
    );
    if (unrecognized) {
      return {
        valid: false,
        error: "Challenge carries unrecognized signatures",
        code: "UNRECOGNIZED_SIGNATURE",
      };
    }

    // Claim the nonce only after every check has passed (#1295). Claiming it
    // earlier let an unsigned or tampered copy of an intercepted challenge
    // "burn" the nonce before the legitimate client submitted it.
    if (!consumeChallengeNonce(valueStr, maxTime)) {
      return { valid: false, error: "Challenge nonce already used", code: "NONCE_REPLAY" };
    }

    return { valid: true, nonce: valueStr };
  } catch (err) {
    // Fail closed, but keep a trace so unexpected parser failures are visible.
    logger.warn({ err: err?.message }, "sep10 challenge verification failed unexpectedly");
    return { valid: false, error: "Authentication failed", code: "AUTHENTICATION_FAILED" };
  }
}

/**
 * Look up a merchant by Stellar recipient with transient-error recovery (#587).
 */
export async function lookupMerchantByStellarAddress(clientAccount, supabaseClient) {
  if (typeof clientAccount !== "string" || clientAccount.length === 0) {
    throw new Sep10AuthError("INVALID_ACCOUNT", "Stellar account is required", 400);
  }
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("SEP-10 merchant lookup requires a store client");
  }

  return withSep10StoreRecovery(async () => {
    const response = await supabaseClient
      .from("merchants")
      .select("id, email, business_name, notification_email")
      .eq("recipient", clientAccount)
      .is("deleted_at", null)
      .maybeSingle();

    if (!response) {
      throw new Error("SEP-10 merchant lookup returned no response");
    }

    const { data, error } = response;

    if (error) {
      // `merchants.recipient` is not unique. When several merchants share the
      // address, maybeSingle() reports PGRST116; refuse to authenticate rather
      // than surface a 500 or risk binding the session to the wrong merchant.
      if (error.code === "PGRST116") {
        logger.warn("sep10 merchant lookup matched multiple merchants for one Stellar address");
        throw new Sep10AuthError(
          "AMBIGUOUS_MERCHANT",
          "Multiple merchant accounts are linked to this Stellar address",
          409,
        );
      }
      if (isRetryableSep10StoreError(error)) {
        throw error;
      }
      error.status = 500;
      throw error;
    }

    return data ?? null;
  }, "sep10_merchant_lookup");
}

export function generateSessionToken(merchantId, email) {
  // Never mint a token whose subject is null/undefined (#1293).
  if (merchantId === null || merchantId === undefined || merchantId === "") {
    throw new Error("Cannot issue a session token without a merchant id");
  }

  return jwt.sign(
    {
      id: merchantId,
      email: email,
      merchant_id: merchantId,
    },
    getJwtSecret(),
    { algorithm: SESSION_TOKEN_ALGORITHM, expiresIn: "24h" },
  );
}

export function verifySessionToken(token) {
  try {
    // Pin the algorithm so a token can't pick its own verification scheme (#1294).
    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: [SESSION_TOKEN_ALGORITHM],
    });
    return { valid: true, payload };
  } catch {
    return { valid: false, error: "Invalid or expired session token" };
  }
}
