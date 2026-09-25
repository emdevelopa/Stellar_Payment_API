import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { logger } from "./logger.js";
import {
  signatureVerificationTotal,
  signatureVerificationDuration,
  signatureVerificationReplayAttempts,
} from "./metrics.js";

const PAYMENT_SIGNATURE_CACHE_TTL_MS = 60_000;
const paymentSignatureCache = new Map();

function getSignatureCacheKey(txHash, merchantId) {
  return `${merchantId || "global"}:${txHash}`;
}

function getCachedVerification(txHash, merchantId) {
  const key = getSignatureCacheKey(txHash, merchantId);
  const cached = paymentSignatureCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > PAYMENT_SIGNATURE_CACHE_TTL_MS) {
    paymentSignatureCache.delete(key);
    return null;
  }
  return cached.result;
}

function setCachedVerification(txHash, merchantId, result) {
  const key = getSignatureCacheKey(txHash, merchantId);
  if (paymentSignatureCache.size > 1000) {
    const oldestKey = paymentSignatureCache.keys().next().value;
    paymentSignatureCache.delete(oldestKey);
  }
  paymentSignatureCache.set(key, { result, timestamp: Date.now() });
}

export function invalidateSignatureCache(txHash, merchantId) {
  const key = getSignatureCacheKey(txHash, merchantId);
  paymentSignatureCache.delete(key);
}

export function clearSignatureCache() {
  paymentSignatureCache.clear();
}

export function signPaymentPayload(payload, secret) {
  if (!secret || typeof secret !== "string") {
    throw new Error("Signing secret is required");
  }
  const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyPaymentPayloadSignature(payload, signature, secret) {
  if (!payload || !signature || !secret) return false;

  const expected = signPaymentPayload(payload, secret);
  const sigStr = String(signature).trim();

  let providedSig = sigStr;
  if (sigStr.startsWith("sha256=")) {
    providedSig = sigStr.slice("sha256=".length);
  }

  if (!/^[a-f0-9]{64}$/i.test(providedSig)) return false;

  const a = Buffer.from(providedSig.toLowerCase(), "utf8");
  const b = Buffer.from(expected.toLowerCase(), "utf8");

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signRequestTimestamp(timestamp, secret) {
  if (!secret) throw new Error("Signing secret is required");
  return createHmac("sha256", secret).update(String(timestamp)).digest("hex");
}

export function verifyRequestTimestamp(timestamp, signature, secret, toleranceSeconds = 300) {
  if (!timestamp || !signature || !secret) return false;

  const now = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(String(timestamp), 10);
  if (Number.isNaN(requestTime)) return false;

  const timeDiff = Math.abs(now - requestTime);
  if (timeDiff > toleranceSeconds) return false;

  const expected = signRequestTimestamp(timestamp, secret);
  const sigStr = String(signature).trim();
  let providedSig = sigStr;
  if (sigStr.startsWith("sha256=")) {
    providedSig = sigStr.slice("sha256=".length);
  }

  if (!/^[a-f0-9]{64}$/i.test(providedSig)) return false;

  const a = Buffer.from(providedSig.toLowerCase(), "utf8");
  const b = Buffer.from(expected.toLowerCase(), "utf8");

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function computeTransactionHash(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function verifyReplayProtection(txHash, merchantId, windowMs = 300_000) {
  const cacheKey = `replay:${merchantId || "global"}:${txHash}`;
  const now = Date.now();

  for (const [key, entry] of paymentSignatureCache.entries()) {
    if (key.startsWith("replay:") && now - entry.timestamp > windowMs) {
      paymentSignatureCache.delete(key);
    }
  }

  if (paymentSignatureCache.has(cacheKey)) {
    signatureVerificationReplayAttempts.inc();
    logger.warn(
      { txHash, merchantId },
      "Payment signature verification: replay attempt detected",
    );
    return false;
  }

  paymentSignatureCache.set(cacheKey, { result: true, timestamp: now });
  return true;
}

export async function verifyPaymentTransactionSignature(txHash, options = {}) {
  const { merchantId = null, useCache = true } = options;
  const startTime = Date.now();

  if (!txHash || typeof txHash !== "string") {
    signatureVerificationTotal.inc({ result: "error" });
    signatureVerificationDuration.observe({ result: "error" }, (Date.now() - startTime) / 1000);
    return {
      valid: false,
      reason: "Invalid transaction hash provided",
      isMultiSig: false,
      signatureCount: 0,
      thresholdMet: false,
      cached: false,
    };
  }

  if (useCache) {
    const cached = getCachedVerification(txHash, merchantId);
    if (cached) {
      logger.debug({ txHash, merchantId }, "Payment signature verification: cache hit");
      return { ...cached, cached: true };
    }
  }

  let verifyTransactionSignature;
  try {
    const stellar = await import("./stellar.js");
    verifyTransactionSignature = stellar.verifyTransactionSignature;
  } catch (err) {
    logger.error({ err }, "Payment signature verification: failed to load stellar module");
    signatureVerificationTotal.inc({ result: "error" });
    signatureVerificationDuration.observe({ result: "error" }, (Date.now() - startTime) / 1000);
    return {
      valid: false,
      reason: "Stellar SDK not available",
      isMultiSig: false,
      signatureCount: 0,
      thresholdMet: false,
      cached: false,
    };
  }

  if (typeof verifyTransactionSignature !== "function") {
    signatureVerificationTotal.inc({ result: "skipped" });
    signatureVerificationDuration.observe({ result: "skipped" }, (Date.now() - startTime) / 1000);
    return {
      valid: true,
      reason: "Signature verification not available — skipped",
      isMultiSig: false,
      signatureCount: 0,
      thresholdMet: false,
      cached: false,
      skipped: true,
    };
  }

  try {
    const result = await verifyTransactionSignature(txHash);

    if (result && typeof result === "object" && result.valid !== undefined) {
      if (useCache) {
        setCachedVerification(txHash, merchantId, result);
      }

      logger.info(
        {
          txHash,
          merchantId,
          valid: result.valid,
          isMultiSig: result.isMultiSig,
          signatureCount: result.signatureCount,
          thresholdMet: result.thresholdMet,
          durationMs: Date.now() - startTime,
        },
        "Payment signature verification: completed",
      );

      return { ...result, cached: false };
    }

    const accepted = result === true || (result && typeof result === "object" && result.valid === true);
    const normalized = {
      valid: accepted,
      reason: accepted ? "Signature accepted" : "Signature rejected",
      isMultiSig: false,
      signatureCount: 0,
      thresholdMet: accepted,
      cached: false,
    };

    if (useCache) {
      setCachedVerification(txHash, merchantId, normalized);
    }

    return normalized;
  } catch (err) {
    logger.error(
      {
        txHash,
        merchantId,
        error: err.message,
        durationMs: Date.now() - startTime,
      },
      "Payment signature verification: unexpected error",
    );

    signatureVerificationTotal.inc({ result: "error" });
    signatureVerificationDuration.observe({ result: "error" }, (Date.now() - startTime) / 1000);

    return {
      valid: false,
      reason: `Verification error: ${err.message}`,
      isMultiSig: false,
      signatureCount: 0,
      thresholdMet: false,
      cached: false,
    };
  }
}

export const paymentSignatureVerifier = {
  verifyTransaction: verifyPaymentTransactionSignature,
  verifyPayload: verifyPaymentPayloadSignature,
  verifyTimestamp: verifyRequestTimestamp,
  signPayload: signPaymentPayload,
  signTimestamp: signRequestTimestamp,
  computeHash: computeTransactionHash,
  checkReplay: verifyReplayProtection,
  invalidateCache: invalidateSignatureCache,
  clearCache: clearSignatureCache,
};
