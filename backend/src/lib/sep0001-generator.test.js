import { describe, expect, it, beforeEach, vi } from "vitest";
import { generateStellarToml, validateStellarToml } from "./sep0001-generator.js";

describe("generateStellarToml", () => {
  beforeEach(() => {
    // Set default environment variables for tests
    process.env.STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    process.env.API_BASE_URL = "http://localhost:4000";
  });

  it("generates valid TOML with required fields", () => {
    const merchant = {
      id: "test-id",
      business_name: "Test Merchant",
      email: "merchant@example.com",
      notification_email: "notify@example.com",
      recipient: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2BRUY4DQAT2B",
      branding_config: {},
    };

    const toml = generateStellarToml(merchant);

    expect(toml).toContain("NETWORK_PASSPHRASE");
    expect(toml).toContain("TRANSFER_SERVER");
    expect(toml).toContain("DOCUMENTATION");
    expect(toml).toContain("[ORG]");
    expect(toml).toContain("Test Merchant");
  });

  it("includes merchant email in contact field", () => {
    const merchant = {
      business_name: "Test Merchant",
      email: "merchant@example.com",
      notification_email: "notify@example.com",
      recipient: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2BRUY4DQAT2B",
      branding_config: {},
    };

    const toml = generateStellarToml(merchant);

    expect(toml).toContain("contact = \"merchant@example.com\"");
    expect(toml).toContain("support = \"notify@example.com\"");
  });

  it("includes branding config when available", () => {
    const merchant = {
      business_name: "Test Merchant",
      email: "merchant@example.com",
      notification_email: "notify@example.com",
      recipient: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2BRUY4DQAT2B",
      branding_config: {
        homepage: "https://example.com",
        logo_url: "https://example.com/logo.png",
      },
    };

    const toml = generateStellarToml(merchant);

    expect(toml).toContain("homepage = \"https://example.com\"");
    expect(toml).toContain("logo = \"https://example.com/logo.png\"");
  });

  it("escapes special characters in strings", () => {
    const merchant = {
      business_name: 'Test "Merchant" with\nnewline',
      email: "merchant@example.com",
      notification_email: "notify@example.com",
      recipient: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2BRUY4DQAT2B",
      branding_config: {},
    };

    const toml = generateStellarToml(merchant);

    expect(toml).toContain('Test \\"Merchant\\" with\\nnewline');
  });

  it("throws error when merchant is null", () => {
    expect(() => generateStellarToml(null)).toThrow("Merchant configuration required");
  });

  it("throws error when merchant is undefined", () => {
    expect(() => generateStellarToml(undefined)).toThrow("Merchant configuration required");
  });
});

describe("validateStellarToml", () => {
  it("validates correct TOML content", () => {
    const toml = `NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
TRANSFER_SERVER = "http://localhost:4000/api"`;

    expect(validateStellarToml(toml)).toBe(true);
  });

  it("rejects TOML missing NETWORK_PASSPHRASE", () => {
    const toml = `TRANSFER_SERVER = "http://localhost:4000/api"`;

    expect(validateStellarToml(toml)).toBe(false);
  });

  it("rejects TOML missing TRANSFER_SERVER", () => {
    const toml = `NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"`;

    expect(validateStellarToml(toml)).toBe(false);
  });

  it("rejects empty content", () => {
    expect(validateStellarToml("")).toBe(false);
    expect(validateStellarToml(null)).toBe(false);
  });
});
