import { beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "./secret-crypto.js";

describe("secret-crypto", () => {
  beforeEach(() => {
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString(
      "base64",
    );
  });

  it("encrypts with non-deterministic ciphertext and decrypts round-trip", () => {
    const plaintext = "whsec_merchant_secret";
    const encryptedA = encryptSecret(plaintext);
    const encryptedB = encryptSecret(plaintext);

    expect(encryptedA).not.toBe(plaintext);
    expect(encryptedA).not.toBe(encryptedB);
    expect(isEncryptedSecret(encryptedA)).toBe(true);
    expect(decryptSecret(encryptedA)).toBe(plaintext);
    expect(decryptSecret(encryptedB)).toBe(plaintext);
  });

  it("passes through plain values for backward compatibility", () => {
    expect(decryptSecret("legacy_plain_secret")).toBe("legacy_plain_secret");
  });
});
