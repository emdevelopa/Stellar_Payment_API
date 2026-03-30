import 'dotenv/config';
import { createHmac, timingSafeEqual } from "crypto";
import { promises as dns } from "dns";
import { isIP } from "net";
import { supabase } from "./supabase.js";

/**
 * Checks if a given IP address is private or loopback.
 */
export function isPrivateIP(ip) {
  // IPv4 Private & Loopback
  if (ip === "0.0.0.0" || ip === "127.0.0.1") return true;

  const parts = ip.split(".").map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true; // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    if (parts[0] === 127) return true; // 127.0.0.0/8
    if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16
  }

  // IPv6 Private & Loopback
  let normalizedIP = ip.toLowerCase();
  if (normalizedIP.startsWith('[') && normalizedIP.endsWith(']')) {
    normalizedIP = normalizedIP.slice(1, -1);
  }

  if (normalizedIP === "::1" || normalizedIP === "0:0:0:0:0:0:0:1" || normalizedIP === "::ffff:127.0.0.1" || normalizedIP.startsWith("fe80:") || normalizedIP.startsWith("fc00:") || normalizedIP.startsWith("fd00:")) return true;

  return false;
}

/**
 * Validates a URL to prevent SSRF by blocking private/internal IPs.
 */
export async function validateWebhookUrl(url) {
  try {
    const parsedUrl = new URL(url);
    let hostname = parsedUrl.hostname.toLowerCase();

    // Remove brackets for IPv6 if present (though URL.hostname usually does this)
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1);
    }

    // 1. Check if it's already an IP
    const ipVersion = isIP(hostname);
    if (ipVersion !== 0) {
      return !isPrivateIP(hostname);
    }

    // 2. Check for localhost explicitly
    if (hostname === "localhost") return false;

    // 3. Resolve hostname to IPs and check them
    // Note: dns.resolve only works for A/AAAA records. 
    // We use lookup as a fallback or primary to get addresses for the current host.
    const addresses = await dns.resolve(hostname).catch(() => []);

    if (addresses.length > 0) {
      for (const addr of addresses) {
        if (isPrivateIP(addr)) return false;
      }
    } else {
      // If no addresses found via resolve, try lookup (handles /etc/hosts etc)
      const { address } = await dns.lookup(hostname).catch(() => ({}));
      if (address && isPrivateIP(address)) return false;
    }

    return true;
  } catch (err) {
    return false;
  }
}

const RETRY_DELAYS_MS = [10_000, 30_000, 60_000]; // 10s, 30s, 60s

/**
 * Signs a serialized payload string with HMAC-SHA256 using the shared secret.
 */
export function signPayload(rawBody, secret) {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

function parseSignatureHeader(signatureHeader) {
  if (typeof signatureHeader !== "string") return null;

  const trimmed = signatureHeader.trim();
  if (!trimmed.startsWith("sha256=")) return null;

  const signature = trimmed.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(signature)) return null;

  return signature.toLowerCase();
}

function signaturesEqual(a, b) {
  const aBuffer = Buffer.from(a, "utf8");
  const bBuffer = Buffer.from(b, "utf8");

  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

/**
 * Verifies a Stellar-Signature header against the merchant webhook secrets.
 * Accepts the current secret and, during grace window, the previous secret.
 */
export function verifyWebhook(rawBody, signatureHeader, merchant) {
  const signature = parseSignatureHeader(signatureHeader);
  if (!signature || !merchant || !merchant.webhook_secret) return false;

  const candidateSecrets = [merchant.webhook_secret];
  if (merchant.webhook_secret_old && merchant.webhook_secret_expiry) {
    const expiry = new Date(merchant.webhook_secret_expiry);
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() > Date.now()) {
      candidateSecrets.push(merchant.webhook_secret_old);
    }
  }

  return candidateSecrets.some((secret) => {
    const expected = signPayload(rawBody, secret);
    return signaturesEqual(signature, expected);
  });
}

/**
 * Verifies webhook signature and timestamp to prevent replay attacks.
 * Timestamp must be within the tolerance window (default 5 minutes).
 */
export function verifyWebhookWithTimestamp(rawBody, signatureHeader, timestamp, merchant, toleranceSeconds = 300) {
  // Verify signature first
  if (!verifyWebhook(rawBody, signatureHeader, merchant)) {
    return false;
  }

  // Verify timestamp is within tolerance
  if (!timestamp) return false;
  
  const webhookTime = parseInt(timestamp, 10);
  if (Number.isNaN(webhookTime)) return false;

  const now = Math.floor(Date.now() / 1000);
  const timeDiff = Math.abs(now - webhookTime);

  return timeDiff <= toleranceSeconds;
}

/**
 * Log webhook delivery attempt to database
 */
async function logWebhookDelivery(paymentId, statusCode, responseBody, requestPayload = null, requestHeaders = null) {
  if (!paymentId) return;

  try {
    await supabase.from("webhook_delivery_logs").insert({
      payment_id: paymentId,
      status_code: statusCode,
      request_payload: requestPayload,
      request_headers: requestHeaders,
      response_body: responseBody ? responseBody.substring(0, 1000) : null // Limit response body size
    });
  } catch (err) {
    console.error("Failed to log webhook delivery:", err.message);
  }
}

async function attempt(url, payload, headers, paymentId) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  const text = await response.text().catch(() => "");

  // Log the delivery attempt with request details
  await logWebhookDelivery(paymentId, response.status, text, payload, headers);

  return { ok: response.ok, status: response.status, body: text };
}

function scheduleRetries(url, payload, headers, paymentId) {
  let attemptIndex = 0;

  function retry() {
    attempt(url, payload, headers, paymentId).then((result) => {
      if (!result.ok && attemptIndex < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attemptIndex];
        attemptIndex++;
        console.log(`Webhook retry ${attemptIndex} for ${url} in ${delay}ms`);
        setTimeout(retry, delay);
      }
    }).catch((err) => {
      if (attemptIndex < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attemptIndex];
        attemptIndex++;
        console.warn(`Webhook retry ${attemptIndex} (error) for ${url} in ${delay}ms:`, err.message);
        setTimeout(retry, delay);
      }
    });
  }

  setTimeout(retry, RETRY_DELAYS_MS[0]);
}

/**
 * Validate and sanitise a merchant-supplied custom headers object.
 *
 * Accepted: plain object whose keys are safe ASCII header names and whose
 * values are non-empty strings.
 * Reserved system headers (Content-Type, User-Agent, Stellar-Signature) are
 * silently dropped to prevent merchants from overriding security controls.
 *
 * @param {unknown} raw  The value stored in merchants.webhook_custom_headers.
 * @returns {Record<string, string>} A safe subset of the supplied headers.
 */
export function sanitizeCustomHeaders(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const SAFE_HEADER_NAME = /^[a-zA-Z0-9\-_]+$/;
  const RESERVED = new Set([
    "content-type",
    "user-agent",
    "stellar-signature",
  ]);

  const result = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!SAFE_HEADER_NAME.test(key)) continue;
    if (RESERVED.has(key.toLowerCase())) continue;
    if (typeof value !== "string" || value.trim() === "") continue;
    result[key] = value;
  }
  return result;
}

/**
 * Returns true if the merchant has subscribed to the given event type.
 *
 * When `subscribed_events` is null, undefined, or an empty array the merchant
 * receives ALL event types (backward-compatible default).
 *
 * @param {object} merchant  - Merchant record (may include subscribed_events).
 * @param {string} eventType - Event type to check, e.g. "payment.confirmed".
 * @returns {boolean}
 */
export function isEventSubscribed(merchant, eventType) {
  const list = merchant?.subscribed_events;
  if (!Array.isArray(list) || list.length === 0) return true;
  return list.includes(eventType);
}

/**
 * Sends a signed webhook POST request to `url`.
 *
 * @param {string}  url           Destination URL.
 * @param {object}  payload       JSON body to send.
 * @param {string}  secret        HMAC signing secret.
 * @param {string|null} paymentId For delivery logging.
 * @param {object}  [customHeaders={}] Merchant-defined extra headers.
 */
export async function sendWebhook(url, payload, secret, paymentId = null, customHeaders = {}) {
  if (!url) return { ok: false, skipped: true };

  const signingSecret = secret || process.env.WEBHOOK_SECRET || "";
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const headers = {
    // Merchant custom headers first so system headers always take precedence.
    ...sanitizeCustomHeaders(customHeaders),
    "Content-Type": "application/json",
    "User-Agent": "stellar-payment-api/0.1",
    "Stellar-Timestamp": timestamp
  };

  if (signingSecret) {
    const signature = signPayload(rawBody, signingSecret);
    headers["Stellar-Signature"] = `sha256=${signature}`;
  }

  const isValid = await validateWebhookUrl(url);
  if (!isValid) {
    console.warn(`Webhook to ${url} blocked: Private or invalid IP address detected (SSRF protection).`);
    return { ok: false, error: "Forbidden: Internal network access is blocked", skipped: false };
  }

  try {
    const result = await attempt(url, payload, headers, paymentId);

    if (!result.ok) {
      console.warn(`Webhook to ${url} failed with status ${result.status}. Scheduling retries.`);
      scheduleRetries(url, payload, headers, paymentId);
    }

    return { ...result, signed: !!signingSecret };
  } catch (err) {
    console.error(`Webhook to ${url} encountered an error: ${err.message}. Scheduling retries.`);

    // Log the error with request details
    if (paymentId) {
      await logWebhookDelivery(paymentId, 0, err.message, payload, headers);
    }

    scheduleRetries(url, payload, headers, paymentId);
    return { ok: false, error: err.message, signed: !!signingSecret };
  }
}
