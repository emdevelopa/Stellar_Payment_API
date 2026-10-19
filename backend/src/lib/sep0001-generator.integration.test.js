import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { generateStellarToml, validateStellarToml } from "./sep0001-generator.js";

const BASE_MERCHANT = {
  id: "merchant-integration-001",
  business_name: "Integration Test Merchant",
  email: "merchant@integration.example.com",
  notification_email: "notify@integration.example.com",
  recipient: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2BRUY4DQAT2B",
  branding_config: {
    homepage: "https://integration.example.com",
    logo_url: "https://integration.example.com/logo.png",
  },
};

// ─── Integration tests ────────────────────────────────────────────────────────

describe("SEP-0001 generator — integration: environment variable handling", () => {
  const savedEnv = {};
  const ENV_KEYS = [
    "STELLAR_NETWORK_PASSPHRASE",
    "API_BASE_URL",
    "TRANSFER_SERVER_URL",
    "FEDERATION_SERVER_URL",
    "SIGNING_KEY",
    "DOCS_URL",
  ];

  beforeEach(() => {
    ENV_KEYS.forEach((k) => {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    });
  });

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    });
  });

  it("uses TRANSFER_SERVER_URL when set, overriding API_BASE_URL default", () => {
    process.env.TRANSFER_SERVER_URL = "https://payments.example.com/api";
    const toml = generateStellarToml(BASE_MERCHANT);
    expect(toml).toContain('TRANSFER_SERVER = "https://payments.example.com/api"');
  });

  it("falls back to API_BASE_URL-derived transfer server when TRANSFER_SERVER_URL is absent", () => {
    process.env.API_BASE_URL = "https://api.example.com";
    const toml = generateStellarToml(BASE_MERCHANT);
    expect(toml).toContain("https://api.example.com/api");
  });

  it("includes FEDERATION_SERVER when env var is set", () => {
    process.env.FEDERATION_SERVER_URL = "https://fed.example.com";
    const toml = generateStellarToml(BASE_MERCHANT);
    expect(toml).toContain('FEDERATION_SERVER = "https://fed.example.com"');
  });

  it("omits FEDERATION_SERVER when env var is absent", () => {
    const toml = generateStellarToml(BASE_MERCHANT);
    expect(toml).not.toContain("FEDERATION_SERVER");
  });

  it("includes SIGNING_KEY when env var is set", () => {
    process.env.SIGNING_KEY = "SCZANGBA5ARYOEX4DYUJC7GPZESCSXOZQIMONZPH5GKIQKP52PCMHHCA";
    const toml = generateStellarToml(BASE_MERCHANT);
    expect(toml).toContain("SIGNING_KEY");
    expect(toml).toContain("SCZANGBA5ARYOEX4DYUJC7GPZESCSXOZQIMONZPH5GKIQKP52PCMHHCA");
  });

  it("omits SIGNING_KEY when env var is absent", () => {
    const toml = generateStellarToml(BASE_MERCHANT);
    expect(toml).not.toContain("SIGNING_KEY");
  });

  it("uses DOCS_URL when set, overriding API_BASE_URL-derived default", () => {
    process.env.DOCS_URL = "https://docs.example.com/api";
    const toml = generateStellarToml(BASE_MERCHANT);
    expect(toml).toContain('DOCUMENTATION = "https://docs.example.com/api"');
  });

  it("uses mainnet passphrase when configured", () => {
    process.env.STELLAR_NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015";
    const toml = generateStellarToml(BASE_MERCHANT);
    expect(toml).toContain("Public Global Stellar Network");
  });
});

describe("SEP-0001 generator — integration: merchant field combinations", () => {
  beforeEach(() => {
    process.env.STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    process.env.API_BASE_URL = "http://localhost:4000";
  });

  it("generates valid TOML for a minimal merchant (no optional fields)", () => {
    const minimal = { business_name: "Minimal Merchant" };
    const toml = generateStellarToml(minimal);
    expect(validateStellarToml(toml)).toBe(true);
    expect(toml).toContain("Minimal Merchant");
    expect(toml).not.toContain("contact");
    expect(toml).not.toContain("support");
    expect(toml).not.toContain("ACCOUNTS");
  });

  it("generates ACCOUNTS list when recipient is provided", () => {
    const toml = generateStellarToml(BASE_MERCHANT);
    expect(toml).toContain(
      `ACCOUNTS = ["GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2BRUY4DQAT2B"]`
    );
  });

  it("output is valid for all generated merchant variants", () => {
    const variants = [
      { business_name: "No Email" },
      { business_name: "With Email", email: "a@b.com" },
      { business_name: "Full", email: "a@b.com", notification_email: "n@b.com", recipient: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGDUPIU2HRHHZLQQFPSH3BB" },
      { ...BASE_MERCHANT },
    ];
    for (const merchant of variants) {
      const toml = generateStellarToml(merchant);
      expect(validateStellarToml(toml)).toBe(true);
    }
  });

  it("TOML output preserves section ordering (top-level fields before [ORG])", () => {
    const toml = generateStellarToml(BASE_MERCHANT);
    const networkIdx = toml.indexOf("NETWORK_PASSPHRASE");
    const transferIdx = toml.indexOf("TRANSFER_SERVER");
    const orgIdx = toml.indexOf("[ORG]");
    expect(networkIdx).toBeLessThan(transferIdx);
    expect(transferIdx).toBeLessThan(orgIdx);
  });

  it("double-quotes are correctly escaped inside business_name", () => {
    const merchant = { ...BASE_MERCHANT, business_name: 'Acme "Best" Payments' };
    const toml = generateStellarToml(merchant);
    expect(toml).toContain('Acme \\"Best\\" Payments');
    expect(validateStellarToml(toml)).toBe(true);
  });

  it("backslashes are correctly escaped inside business_name", () => {
    const merchant = { ...BASE_MERCHANT, business_name: "Acme\\Corp" };
    const toml = generateStellarToml(merchant);
    expect(toml).toContain("Acme\\\\Corp");
  });

  it("newlines are escaped in string fields", () => {
    const merchant = { ...BASE_MERCHANT, business_name: "Line1\nLine2" };
    const toml = generateStellarToml(merchant);
    expect(toml).toContain("Line1\\nLine2");
    expect(validateStellarToml(toml)).toBe(true);
  });
});

// ─── Stress tests ─────────────────────────────────────────────────────────────

describe("SEP-0001 generator — stress: throughput and concurrency", () => {
  beforeEach(() => {
    process.env.STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
    process.env.API_BASE_URL = "http://localhost:4000";
  });

  it("generates 1 000 TOMLs sequentially in under 500 ms", () => {
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      const merchant = { ...BASE_MERCHANT, id: `merchant-${i}`, business_name: `Merchant ${i}` };
      const toml = generateStellarToml(merchant);
      expect(validateStellarToml(toml)).toBe(true);
    }
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("generates 200 TOMLs concurrently without errors", async () => {
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        Promise.resolve(
          generateStellarToml({ ...BASE_MERCHANT, id: `concurrent-${i}`, business_name: `Merchant ${i}` })
        )
      )
    );
    expect(results).toHaveLength(200);
    results.forEach((toml) => expect(validateStellarToml(toml)).toBe(true));
  });

  it("handles very long string fields without crashing", () => {
    const longName = "A".repeat(10_000);
    const merchant = { ...BASE_MERCHANT, business_name: longName };
    const toml = generateStellarToml(merchant);
    expect(validateStellarToml(toml)).toBe(true);
    expect(toml).toContain(longName);
  });

  it("handles merchants with unicode characters in business_name", () => {
    const merchants = [
      { business_name: "支付商户" },
      { business_name: "Händler GmbH" },
      { business_name: "商人 & Co." },
      { business_name: "مؤسسة المدفوعات" },
    ];
    for (const merchant of merchants) {
      const toml = generateStellarToml(merchant);
      expect(validateStellarToml(toml)).toBe(true);
    }
  });
});
