import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  validateStellarAddress,
  validateAssetCode,
  validateWebhookUrl,
  validateApiKeyFormat,
} from "./security.js";

describe("Security Validation Functions", () => {
  describe("validateStellarAddress", () => {
    it("accepts valid Stellar addresses", () => {
      // Valid Stellar addresses: G + 55 base32 chars (A-Z and 2-7)
      expect(validateStellarAddress("GBRPYHIL2CI3WHZDTOOQFC6EB4PSYKFEKCRCTLWJVFIND4B5OVSXSDVJ")).toBe(true);
      expect(validateStellarAddress("GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTAQXDGNVGW2FDTFRPP5LPLTMP")).toBe(true);
    });

    it("rejects invalid Stellar addresses", () => {
      expect(validateStellarAddress("INVALID")).toBe(false);
      expect(validateStellarAddress("gbrpyhil2ci3whzdtooqfc6eb4psykfekcrctlwjvfind4b5ovsxsdvj")).toBe(false); // lowercase
      expect(validateStellarAddress("GBRPYHIL2CI3WHZDTOOQFC6EB4PSYKFEKCRCTLWJVFIND4B5OVqwrw")).toBe(false); // lowercase in address
      expect(validateStellarAddress("GBRPYHIL2CI3WHZDTOOQFC6EB4PSYKFEKCRCTLWJVFIND4B5OVqwrwm")).toBe(false); // contains invalid char
      expect(validateStellarAddress(null)).toBe(false);
      expect(validateStellarAddress(undefined)).toBe(false);
      expect(validateStellarAddress("")).toBe(false);
    });

    it("rejects non-string values", () => {
      expect(validateStellarAddress(123)).toBe(false);
      expect(validateStellarAddress({})).toBe(false);
      expect(validateStellarAddress([])).toBe(false);
    });
  });

  describe("validateAssetCode", () => {
    it("accepts valid asset codes", () => {
      expect(validateAssetCode("XLM")).toBe(true);
      expect(validateAssetCode("USDC")).toBe(true);
      expect(validateAssetCode("BTC")).toBe(true);
      expect(validateAssetCode("A")).toBe(true); // 1 character
      expect(validateAssetCode("ABCDEFGHIJKL")).toBe(true); // 12 characters
    });

    it("rejects invalid asset codes", () => {
      expect(validateAssetCode("")).toBe(false); // empty
      expect(validateAssetCode("ABCDEFGHIJKLM")).toBe(false); // 13 characters (too long)
      expect(validateAssetCode("US CD")).toBe(false); // contains space
      expect(validateAssetCode("USD-C")).toBe(false); // contains hyphen
      expect(validateAssetCode(null)).toBe(false);
      expect(validateAssetCode(undefined)).toBe(false);
    });

    it("rejects non-string values", () => {
      expect(validateAssetCode(123)).toBe(false);
      expect(validateAssetCode({})).toBe(false);
    });
  });

  describe("validateWebhookUrl", () => {
    it("accepts valid webhook URLs", () => {
      expect(validateWebhookUrl("https://example.com/webhook")).toBe(true);
      expect(validateWebhookUrl("http://example.com/webhook")).toBe(true);
      expect(validateWebhookUrl("https://api.example.com:8443/path?query=value")).toBe(true);
    });

    it("rejects invalid protocols", () => {
      expect(validateWebhookUrl("ftp://example.com/webhook")).toBe(false);
      expect(validateWebhookUrl("file:///etc/passwd")).toBe(false);
      expect(validateWebhookUrl("javascript:alert('xss')")).toBe(false);
    });

    it("rejects localhost in production", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      expect(validateWebhookUrl("http://localhost:8000/webhook")).toBe(false);
      expect(validateWebhookUrl("http://127.0.0.1/webhook")).toBe(false);
      expect(validateWebhookUrl("http://192.168.1.1/webhook")).toBe(false);
      expect(validateWebhookUrl("http://10.0.0.1/webhook")).toBe(false);
      expect(validateWebhookUrl("http://172.16.0.1/webhook")).toBe(false);

      process.env.NODE_ENV = originalEnv;
    });

    it("allows localhost in development", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      expect(validateWebhookUrl("http://localhost:8000/webhook")).toBe(true);
      expect(validateWebhookUrl("http://127.0.0.1/webhook")).toBe(true);

      process.env.NODE_ENV = originalEnv;
    });

    it("rejects non-string values", () => {
      expect(validateWebhookUrl(null)).toBe(false);
      expect(validateWebhookUrl(undefined)).toBe(false);
      expect(validateWebhookUrl(123)).toBe(false);
      expect(validateWebhookUrl({})).toBe(false);
    });
  });

  describe("validateApiKeyFormat", () => {
    it("accepts valid API key format", () => {
      // sk_ + exactly 48 hex characters
      expect(validateApiKeyFormat("sk_" + "a".repeat(48))).toBe(true);
      expect(validateApiKeyFormat("sk_" + "0123456789abcdef".repeat(3))).toBe(true); // 48 hex chars
    });

    it("rejects invalid API key formats", () => {
      expect(validateApiKeyFormat("sk_" + "a".repeat(47))).toBe(false); // too short (47 chars)
      expect(validateApiKeyFormat("sk_" + "a".repeat(49))).toBe(false); // too long (49 chars)
      expect(validateApiKeyFormat("invalid_key")).toBe(false); // wrong prefix
      expect(validateApiKeyFormat("sk_" + "z".repeat(48))).toBe(false); // non-hex character
      expect(validateApiKeyFormat(null)).toBe(false);
      expect(validateApiKeyFormat(undefined)).toBe(false);
      expect(validateApiKeyFormat("")).toBe(false);
    });

    it("rejects non-string values", () => {
      expect(validateApiKeyFormat(123)).toBe(false);
      expect(validateApiKeyFormat({})).toBe(false);
      expect(validateApiKeyFormat([])).toBe(false);
    });
  });
});
