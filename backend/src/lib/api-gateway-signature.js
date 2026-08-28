import crypto from "node:crypto";
import { logger } from "./logger.js";
import { apiGatewaySignatureCacheSize, apiGatewayReplayBlockedTotal } from "./metrics.js";
import { connectRedisClient } from "./redis.js";

const DEFAULT_SIGNATURE_WINDOW_SECONDS = 300;
// Minimum HMAC secret length to prevent signing with trivially weak keys
const MIN_SECRET_LENGTH = 16;

// Supported key rotation indices: 0 = current, 1 = previous
const MAX_KEY_ROTATION_DEPTH = 2;

// Rate limiting for API gateway signature verification (issue #897)
const API_GATEWAY_RATE_LIMIT_MAX = Number(process.env.API_GATEWAY_RATE_LIMIT_MAX || 100);
const API_GATEWAY_RATE_LIMIT_WINDOW_MS = Number(process.env.API_GATEWAY_RATE_LIMIT_WINDOW_MS || 60000);

// Security audit #901: Enhanced rate limiting with cleanup and error recovery
const _apiGatewayRateLimitState = new Map();
const RATE_LIMIT_CLEANUP_THRESHOLD = 10000;
const RATE_LIMIT_STALE_THRESHOLD_MS = API_GATEWAY_RATE_LIMIT_WINDOW_MS * 2;

// Export for testing
export { _apiGatewayRateLimitState };

// Circuit breaker for signature verification failures (#900)
const CIRCUIT_BREAKER_THRESHOLD = 50;
const CIRCUIT_BREAKER_RESET_MS = 60000;
let _circuitBreakerFailures = 0;
let _circuitBreakerLastFailureTime = 0;
let _circuitBreakerOpen = false;

// Replay-protection cache (issue #1060): once a signature has been
// successfully verified it is remembered for the remainder of its
// timestamp tolerance window, so an attacker who captures a validly signed
// request in transit cannot replay it verbatim. Keyed on the signature
// itself (already a per-request HMAC over method+path+timestamp+body, so
// two distinct requests colliding is cryptographically infeasible).
// Bounded and self-cleaning, mirroring the rate-limit map's strategy above.
const _verifiedSignatureCache = new Map(); // signature -> expiresAtMs
const SIGNATURE_CACHE_CLEANUP_THRESHOLD = 10000;

export { _verifiedSignatureCache };

export function _resetApiGatewayRateLimitStateForTests() {
  _apiGatewayRateLimitState.clear();
  _circuitBreakerFailures = 0;
  _circuitBreakerLastFailureTime = 0;
  _circuitBreakerOpen = false;
  _verifiedSignatureCache.clear();
}

function _cleanupExpiredSignatureCacheEntries(now = Date.now()) {
  if (_verifiedSignatureCache.size <= SIGNATURE_CACHE_CLEANUP_THRESHOLD) {
    return;
  }

  let cleaned = 0;
  for (const [signature, expiresAt] of _verifiedSignatureCache.entries()) {
    if (now >= expiresAt) {
      _verifiedSignatureCache.delete(signature);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug({ cleaned, remaining: _verifiedSignatureCache.size }, "Cleaned expired API gateway signature cache entries");
  }
}

function _isReplayedSignature(signature, now = Date.now()) {
  const expiresAt = _verifiedSignatureCache.get(signature);
  if (expiresAt === undefined) return false;
  if (now >= expiresAt) {
    // Expired naturally (its own tolerance window has passed) — no longer a replay risk.
    _verifiedSignatureCache.delete(signature);
    return false;
  }
  return true;
}

function _rememberVerifiedSignature(signature, toleranceSeconds, now = Date.now()) {
  try {
    _verifiedSignatureCache.set(signature, now + Math.max(toleranceSeconds, 0) * 1000);
    apiGatewaySignatureCacheSize.set(_verifiedSignatureCache.size);
    _cleanupExpiredSignatureCacheEntries(now);
  } catch (err) {
    logger.warn({ err }, "Failed to record verified API gateway signature for replay protection");
  }
}

/**
 * Inspect the replay-protection cache. Exposed for monitoring/debugging.
 * @returns {{ size: number }}
 */
export function getApiGatewaySignatureCacheStats() {
  return { size: _verifiedSignatureCache.size };
}

// Security audit #901: Cleanup stale rate limit entries to prevent memory exhaustion
function _cleanupStaleRateLimitEntries(now = Date.now()) {
  if (_apiGatewayRateLimitState.size <= RATE_LIMIT_CLEANUP_THRESHOLD) {
    return;
  }

  let cleaned = 0;
  for (const [key, state] of _apiGatewayRateLimitState.entries()) {
    if (now - state.windowStart > RATE_LIMIT_STALE_THRESHOLD_MS) {
      _apiGatewayRateLimitState.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug({ cleaned, remaining: _apiGatewayRateLimitState.size }, "Cleaned stale API gateway rate limit entries");
  }
}

// Error recovery #900: Circuit breaker pattern for signature verification
function _isCircuitBreakerOpen(now = Date.now()) {
  if (!_circuitBreakerOpen) {
    return false;
  }

  // Attempt to reset circuit breaker after cooldown period
  if (now - _circuitBreakerLastFailureTime > CIRCUIT_BREAKER_RESET_MS) {
    _circuitBreakerOpen = false;
    _circuitBreakerFailures = 0;
    logger.info("API gateway signature verification circuit breaker reset");
    return false;
  }

  return true;
}

function _recordCircuitBreakerFailure(now = Date.now()) {
  _circuitBreakerFailures++;
  _circuitBreakerLastFailureTime = now;

  if (_circuitBreakerFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    _circuitBreakerOpen = true;
    logger.error(
      { failures: _circuitBreakerFailures },
      "API gateway signature verification circuit breaker opened due to repeated failures"
    );
  }
}

function _recordCircuitBreakerSuccess() {
  if (_circuitBreakerFailures > 0) {
    _circuitBreakerFailures = Math.max(0, _circuitBreakerFailures - 1);
  }
}

function getApiGatewayRateLimitKey(ip) {
  return `api-gateway:${ip || "unknown"}`;
}

function isApiGatewayRateLimited(ip, now = Date.now()) {
  const key = getApiGatewayRateLimitKey(ip);
  const state = _apiGatewayRateLimitState.get(key);

  if (!state || now >= state.windowStart + API_GATEWAY_RATE_LIMIT_WINDOW_MS) {
    return false;
  }

  return state.count >= API_GATEWAY_RATE_LIMIT_MAX;
}

function recordApiGatewaySignatureAttempt(ip, success, now = Date.now()) {
  try {
    const key = getApiGatewayRateLimitKey(ip);
    const state = _apiGatewayRateLimitState.get(key);

    if (!state || now >= state.windowStart + API_GATEWAY_RATE_LIMIT_WINDOW_MS) {
      _apiGatewayRateLimitState.set(key, {
        count: 1,
        windowStart: now,
        failures: success ? 0 : 1,
      });
    } else {
      state.count += 1;
      if (!success) {
        state.failures += 1;
      }
    }

    // Security audit #901: Periodic cleanup of stale entries
    _cleanupStaleRateLimitEntries(now);
  } catch (err) {
    // Error recovery #900: Log but don't fail the request
    logger.warn({ err, ip }, "Failed to record API gateway signature attempt");
  }
}

function getApiGatewayRateLimitInfo(ip, now = Date.now()) {
  const key = getApiGatewayRateLimitKey(ip);
  const state = _apiGatewayRateLimitState.get(key);

  if (!state || now >= state.windowStart + API_GATEWAY_RATE_LIMIT_WINDOW_MS) {
    return {
      allowed: true,
      remaining: API_GATEWAY_RATE_LIMIT_MAX,
      resetTime: now + API_GATEWAY_RATE_LIMIT_WINDOW_MS,
    };
  }

  return {
    allowed: state.count < API_GATEWAY_RATE_LIMIT_MAX,
    remaining: Math.max(0, API_GATEWAY_RATE_LIMIT_MAX - state.count),
    resetTime: state.windowStart + API_GATEWAY_RATE_LIMIT_WINDOW_MS,
  };
}

function normalizeSignatureHeader(signatureHeader) {
  try {
    if (typeof signatureHeader !== "string") return null;
    const trimmed = signatureHeader.trim();
    if (!trimmed.startsWith("sha256=")) return null;
    const signature = trimmed.slice("sha256=".length).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(signature)) return null;
    return signature;
  } catch (err) {
    logger.warn({ err }, "Failed to normalize signature header");
    return null;
  }
}

function safeJsonStringify(value) {
  try {
    if (value === undefined) {
      return "";
    }
    return JSON.stringify(value);
  } catch (err) {
    logger.warn({ err }, "Failed to stringify value for signature");
    return "";
  }
}

function buildCanonicalPayload({ method, path, timestamp, body }) {
  try {
    const normalizedMethod = String(method || "GET").toUpperCase();
    const normalizedPath = String(path || "/");
    const bodyHash = crypto
      .createHash("sha256")
      .update(safeJsonStringify(body), "utf8")
      .digest("hex");

    return `${normalizedMethod}\n${normalizedPath}\n${timestamp}\n${bodyHash}`;
  } catch (err) {
    logger.warn({ err }, "Failed to build canonical payload");
    throw new Error("Failed to build canonical payload for signature");
  }
}

// Methods whose signatures are eligible for replay protection. Read-only
// requests are deliberately excluded: the signature only covers
// method+path+timestamp+body with 1-second timestamp granularity, so two
// genuinely distinct GET requests issued within the same second (e.g. a
// client polling an unchanged query) can legitimately produce an identical
// signature - indistinguishable from a captured replay. Replay protection
// is most valuable (and least likely to cause false positives) on
// state-changing requests, where re-execution has a real side effect.
const REPLAY_PROTECTED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isReplayProtectedMethod(method) {
  return REPLAY_PROTECTED_METHODS.has(String(method || "GET").toUpperCase());
}

function distributedReplayKey(secret, signatureHeader) {
  return `api-gateway:replay:${crypto
    .createHash("sha256")
    .update(`${secret}:${signatureHeader}`, "utf8")
    .digest("hex")}`;
}

/**
 * Atomically reserve a mutating request signature across API instances.
 * Redis SET NX is used when REDIS_URL is configured; the verifier's local
 * cache remains the fallback for single-instance deployments.
 */
export async function reserveApiGatewaySignature({
  secret,
  signatureHeader,
  method,
  toleranceSeconds,
  redisClient,
}) {
  if (!isReplayProtectedMethod(method)) return { reserved: true };

  if (!process.env.REDIS_URL && !redisClient) return { reserved: true };

  try {
    const client = redisClient || (await connectRedisClient());
    if (!client?.isOpen) {
      throw new Error("Redis is unavailable for distributed replay protection");
    }

    const result = await client.set(
      distributedReplayKey(secret, signatureHeader),
      "1",
      { NX: true, EX: Math.max(1, Math.ceil(toleranceSeconds)) },
    );

    if (result !== "OK") {
      apiGatewayReplayBlockedTotal.inc();
      logger.warn("Rejected replayed API gateway signature from distributed cache");
      return { reserved: false, replay: true };
    }

    return { reserved: true };
  } catch (err) {
    logger.error({ err }, "Distributed API gateway replay protection unavailable");
    return {
      reserved: false,
      code: "API_GATEWAY_REPLAY_PROTECTION_UNAVAILABLE",
      reason: "API gateway replay protection is temporarily unavailable",
    };
  }
}

function signaturesEqual(a, b) {
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");

  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Verify signature using key rotation support.
 * Tries each secret in sequence, returning the first valid result.
 *
 * @param {Array<string>} secrets - Array of secrets to try (current + previous)
 * @param {object} params - Parameters for signature verification
 * @returns {{ valid: boolean, reason?: string, keyIndex?: number }}
 */
export function verifyApiGatewayRequestSignatureWithRotation({
  secrets,
  method,
  path,
  timestampHeader,
  signatureHeader,
  body,
  now = Date.now(),
  toleranceSeconds = Number(
    process.env.API_GATEWAY_SIGNATURE_TOLERANCE_SECONDS || DEFAULT_SIGNATURE_WINDOW_SECONDS,
  ),
}) {
  for (let keyIndex = 0; keyIndex < secrets.length; keyIndex++) {
    const secret = secrets[keyIndex];
    const result = verifyApiGatewayRequestSignature({
      secret,
      method,
      path,
      timestampHeader,
      signatureHeader,
      body,
      now,
      toleranceSeconds,
    });

    if (result.valid) {
      return { valid: true, keyIndex };
    }
  }

  return { valid: false, reason: "Request signature verification failed with all provided keys" };
}

function getCurrentAndPreviousSecret(currentSecret, previousSecret) {
  if (!previousSecret) return [currentSecret];
  return [currentSecret, previousSecret].filter((s) => s != null);
}


export function signApiGatewayRequest({
  secret,
  method,
  path,
  timestamp,
  body,
}) {
  try {
    if (!secret || secret.length < MIN_SECRET_LENGTH || !timestamp) {
      logger.warn({ secretLength: secret?.length }, "Invalid parameters for signing API gateway request");
      return null;
    }

    const payload = buildCanonicalPayload({ method, path, timestamp, body });
    return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  } catch (err) {
    logger.error({ err }, "Failed to sign API gateway request");
    return null;
  }
}

export function verifyApiGatewayRequestSignature({
  secret,
  method,
  path,
  timestampHeader,
  signatureHeader,
  body,
  clientIp,
  now = Date.now(),
  toleranceSeconds = Number(
    process.env.API_GATEWAY_SIGNATURE_TOLERANCE_SECONDS || DEFAULT_SIGNATURE_WINDOW_SECONDS,
  ),
}) {
  // Error recovery #900: Check circuit breaker first
  if (_isCircuitBreakerOpen(now)) {
    logger.warn("API gateway signature verification circuit breaker is open, rejecting request");
    return {
      valid: false,
      reason: "Signature verification temporarily unavailable due to repeated failures",
      code: "API_GATEWAY_CIRCUIT_BREAKER_OPEN",
    };
  }

  try {
    // Rate limiting check (issue #897)
    if (clientIp && isApiGatewayRateLimited(clientIp, now)) {
      const rateLimitInfo = getApiGatewayRateLimitInfo(clientIp, now);
      logger.warn({ clientIp, rateLimitInfo }, "API gateway signature verification rate limit exceeded");
      return {
        valid: false,
        reason: "API gateway signature verification rate limit exceeded",
        code: "API_GATEWAY_RATE_LIMITED",
        rateLimitInfo,
      };
    }

    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      recordApiGatewaySignatureAttempt(clientIp, false, now);
      _recordCircuitBreakerFailure(now);
      logger.warn({ secretLength: secret?.length, clientIp }, "Missing or insufficient signature secret");
      return { valid: false, reason: "Missing or insufficient signature secret" };
    }

    const timestampValue = String(timestampHeader || "").trim();
    if (!/^[0-9]+$/.test(timestampValue)) {
      recordApiGatewaySignatureAttempt(clientIp, false, now);
      _recordCircuitBreakerFailure(now);
      logger.warn({ timestampHeader, clientIp }, "Missing or invalid x-api-timestamp header");
      return { valid: false, reason: "Missing or invalid x-api-timestamp header" };
    }
    const timestamp = Number(timestampValue);
    if (!Number.isSafeInteger(timestamp)) {
      recordApiGatewaySignatureAttempt(clientIp, false, now);
      _recordCircuitBreakerFailure(now);
      logger.warn({ clientIp }, "API gateway timestamp exceeds safe integer range");
      return { valid: false, reason: "Missing or invalid x-api-timestamp header" };
    }

    const deltaSeconds = Math.abs(Math.floor(now / 1000) - timestamp);
    if (deltaSeconds > toleranceSeconds) {
      recordApiGatewaySignatureAttempt(clientIp, false, now);
      _recordCircuitBreakerFailure(now);
      logger.warn({ deltaSeconds, toleranceSeconds, clientIp }, "Request signature timestamp outside accepted window");
      return { valid: false, reason: "Request signature timestamp is outside the accepted window" };
    }

    const receivedSignature = normalizeSignatureHeader(signatureHeader);
    if (!receivedSignature) {
      recordApiGatewaySignatureAttempt(clientIp, false, now);
      _recordCircuitBreakerFailure(now);
      logger.warn({ signatureHeader, clientIp }, "Missing or invalid x-api-signature header");
      return { valid: false, reason: "Missing or invalid x-api-signature header" };
    }

    const expected = signApiGatewayRequest({
      secret,
      method,
      path,
      timestamp,
      body,
    });

    if (!expected || !signaturesEqual(receivedSignature, expected)) {
      recordApiGatewaySignatureAttempt(clientIp, false, now);
      _recordCircuitBreakerFailure(now);
      logger.warn({ clientIp, method, path }, "Request signature verification failed");
      return { valid: false, reason: "Request signature verification failed" };
    }

    // Replay protection (issue #1060): a cryptographically valid signature
    // that has already been used within its own tolerance window is a
    // replay of a captured request, not a legitimate second use. Scoped to
    // state-changing methods only - see REPLAY_PROTECTED_METHODS.
    const isReplayProtected = isReplayProtectedMethod(method);
    if (isReplayProtected && _isReplayedSignature(receivedSignature, now)) {
      recordApiGatewaySignatureAttempt(clientIp, false, now);
      _recordCircuitBreakerFailure(now);
      apiGatewayReplayBlockedTotal.inc();
      logger.warn({ clientIp, method, path }, "Rejected replayed API gateway signature");
      return {
        valid: false,
        reason: "Signature has already been used and cannot be replayed",
        code: "API_GATEWAY_REPLAY_DETECTED",
      };
    }

    if (isReplayProtected) {
      _rememberVerifiedSignature(receivedSignature, toleranceSeconds, now);
    }
    recordApiGatewaySignatureAttempt(clientIp, true, now);
    _recordCircuitBreakerSuccess();
    return { valid: true };
  } catch (err) {
    // Error recovery #900: Catch unexpected errors and fail gracefully
    _recordCircuitBreakerFailure(now);
    logger.error({ err, clientIp }, "Unexpected error during API gateway signature verification");
    return {
      valid: false,
      reason: "Signature verification encountered an unexpected error",
      code: "API_GATEWAY_VERIFICATION_ERROR",
    };
  }
}
