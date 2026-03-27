import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENCRYPTED_PREFIX = "enc:v1:";
const KEY_BYTES = 32;
const IV_BYTES = 12;

let cachedKey = null;

function decodeKey(rawKey) {
  if (!rawKey || typeof rawKey !== "string") {
    throw new Error(
      "WEBHOOK_SECRET_ENCRYPTION_KEY is required and must be a base64-encoded 32-byte key",
    );
  }

  const decoded = Buffer.from(rawKey, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      "WEBHOOK_SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes",
    );
  }

  return decoded;
}

export function getWebhookSecretsEncryptionKey() {
  if (cachedKey) return cachedKey;
  cachedKey = decodeKey(process.env.WEBHOOK_SECRET_ENCRYPTION_KEY);
  return cachedKey;
}

export function isEncryptedSecret(value) {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptSecret(plaintext) {
  if (!plaintext) return plaintext;

  const key = getWebhookSecretsEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, ciphertext]).toString("base64url");

  return `${ENCRYPTED_PREFIX}${payload}`;
}

export function decryptSecret(value) {
  if (!value) return value;
  if (!isEncryptedSecret(value)) return value;

  const key = getWebhookSecretsEncryptionKey();
  const raw = value.slice(ENCRYPTED_PREFIX.length);
  const decoded = Buffer.from(raw, "base64url");

  if (decoded.length <= IV_BYTES + 16) {
    throw new Error("Encrypted webhook secret payload is malformed");
  }

  const iv = decoded.subarray(0, IV_BYTES);
  const authTag = decoded.subarray(IV_BYTES, IV_BYTES + 16);
  const ciphertext = decoded.subarray(IV_BYTES + 16);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
