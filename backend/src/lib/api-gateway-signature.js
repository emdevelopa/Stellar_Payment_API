import crypto from "node:crypto";

const DEFAULT_SIGNATURE_WINDOW_SECONDS = 300;

function normalizeSignatureHeader(signatureHeader) {
  if (typeof signatureHeader !== "string") return null;
  const trimmed = signatureHeader.trim();
  if (!trimmed.startsWith("sha256=")) return null;
  const signature = trimmed.slice("sha256=".length).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(signature)) return null;
  return signature;
}

function safeJsonStringify(value) {
  try {
    if (value === undefined) {
      return "";
    }
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function buildCanonicalPayload({ method, path, timestamp, body }) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const normalizedPath = String(path || "/");
  const bodyHash = crypto
    .createHash("sha256")
    .update(safeJsonStringify(body), "utf8")
    .digest("hex");

  return `${normalizedMethod}\n${normalizedPath}\n${timestamp}\n${bodyHash}`;
}

function signaturesEqual(a, b) {
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");

  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function signApiGatewayRequest({
  secret,
  method,
  path,
  timestamp,
  body,
}) {
  if (!secret || !timestamp) {
    return null;
  }

  const payload = buildCanonicalPayload({ method, path, timestamp, body });
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function verifyApiGatewayRequestSignature({
  secret,
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
  if (!secret) {
    return { valid: false, reason: "Missing signature secret" };
  }

  const timestamp = Number.parseInt(String(timestampHeader || ""), 10);
  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: "Missing or invalid x-api-timestamp header" };
  }

  const deltaSeconds = Math.abs(Math.floor(now / 1000) - timestamp);
  if (deltaSeconds > toleranceSeconds) {
    return { valid: false, reason: "Request signature timestamp is outside the accepted window" };
  }

  const receivedSignature = normalizeSignatureHeader(signatureHeader);
  if (!receivedSignature) {
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
    return { valid: false, reason: "Request signature verification failed" };
  }

  return { valid: true };
}
