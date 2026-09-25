import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {

  MINIMUM_XLM_PAYMENT_AMOUNT,
  pathPaymentQuoteQuerySchema,
  paymentZodSchema,
  paymentSessionZodSchema,
  registerMerchantZodSchema,
  v2PaymentSessionSchema,
} from "./request-schemas.js";

const USDC_TESTNET_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("paymentZodSchema", () => {
  it("parses and normalizes a valid create-payment request", () => {
    const result = paymentZodSchema.parse({
      amount: "42.5",
      asset: "usdc",
      asset_issuer: ` ${USDC_TESTNET_ISSUER} `,
      recipient: " GRECIPIENT ",
      client_id: " store-01 ",
      memo: " Order-123 ",
      memo_type: "TEXT",
      webhook_url: "https://merchant.example/webhook",
      metadata: { orderId: "123" },
    });

    expect(result).toEqual({
      amount: 42.5,
      asset: "USDC",
      asset_issuer: USDC_TESTNET_ISSUER,
      recipient: "GRECIPIENT",
      client_id: "store-01",
      description: undefined,
      memo: "Order-123",
      memo_type: "text",
      webhook_url: "https://merchant.example/webhook",
      metadata: { orderId: "123" },
    });
  });

  it("recovers the default issuer for configured non-native assets", () => {
    const result = paymentZodSchema.parse({
      amount: 50,
      asset: "USDC",
      recipient: "GRECIPIENT",
    });

    expect(result.asset_issuer).toBe(USDC_TESTNET_ISSUER);
  });

  it("requires asset_issuer for non-native assets without configured defaults", () => {
    expect(() =>
      paymentZodSchema.parse({
        amount: 50,
        asset: "EURC",
        recipient: "GRECIPIENT",
      })
    ).toThrowError("asset_issuer is required for non-native assets");
  });

  it("rejects invalid asset_issuer public keys", () => {
    expect(() =>
      paymentZodSchema.parse({
        amount: 50,
        asset: "EURC",
        asset_issuer: "issuer-1",
        recipient: "GRECIPIENT",
      })
    ).toThrowError("asset_issuer must be a valid Stellar public key");
  });

  it("ignores asset_issuer for native XLM payments", () => {
    const result = paymentZodSchema.parse({
      amount: 50,
      asset: "XLM",
      asset_issuer: USDC_TESTNET_ISSUER,
      recipient: "GRECIPIENT",
    });

    expect(result.asset_issuer).toBeUndefined();
  });

  it("requires memo_type when memo is provided", () => {
    expect(() =>
      paymentZodSchema.parse({
        amount: 50,
        asset: "XLM",
        recipient: "GRECIPIENT",
        memo: "order-123",
      })
    ).toThrowError("memo_type is required when memo is provided");
  });

  it("requires memo when memo_type is provided", () => {
    expect(() =>
      paymentZodSchema.parse({
        amount: 50,
        asset: "XLM",
        recipient: "GRECIPIENT",
        memo_type: "text",
      })
    ).toThrowError("memo is required when memo_type is provided");
  });

  it("rejects invalid memo types", () => {
    expect(() =>
      paymentZodSchema.parse({
        amount: 50,
        asset: "XLM",
        recipient: "GRECIPIENT",
        memo: "order-123",
        memo_type: "foo",
      })
    ).toThrowError("Invalid memo_type. Must be one of: text, id, hash, return");
  });

  it("accepts a valid return memo (32-byte hex)", () => {
    const hash = "a".repeat(64);
    const result = paymentZodSchema.parse({
      amount: 50,
      asset: "XLM",
      recipient: "GRECIPIENT",
      memo: hash,
      memo_type: "return",
    });
    expect(result.memo).toBe(hash);
    expect(result.memo_type).toBe("return");
  });

  it("accepts a valid return memo (unsigned 64-bit integer)", () => {
    const result = paymentZodSchema.parse({
      amount: 50,
      asset: "XLM",
      recipient: "GRECIPIENT",
      memo: "18446744073709551615",
      memo_type: "return",
    });
    expect(result.memo).toBe("18446744073709551615");
    expect(result.memo_type).toBe("return");
  });

  it("rejects a return memo that is neither valid id nor 64 hex characters", () => {
    expect(() =>
      paymentZodSchema.parse({
        amount: 50,
        asset: "XLM",
        recipient: "GRECIPIENT",
        memo: "tooshort",
        memo_type: "return",
      })
    ).toThrowError(
      "memo must be a valid unsigned 64-bit integer or a 32-byte hex string (64 characters) when memo_type is return"
    );
  });

  it("accepts a valid hash memo (32-byte hex)", () => {
    const hash = "ab12cd34".repeat(8);
    const result = paymentZodSchema.parse({
      amount: 50,
      asset: "XLM",
      recipient: "GRECIPIENT",
      memo: hash,
      memo_type: "hash",
    });
    expect(result.memo).toBe(hash);
  });

  it("rejects a hash memo that is not 64 hex characters", () => {
    expect(() =>
      paymentZodSchema.parse({
        amount: 50,
        asset: "XLM",
        recipient: "GRECIPIENT",
        memo: "xyz",
        memo_type: "hash",
      })
    ).toThrowError("memo must be a 32-byte hex string (64 characters) when memo_type is hash");
  });

  it("accepts a valid id memo (unsigned 64-bit integer)", () => {
    const result = paymentZodSchema.parse({
      amount: 50,
      asset: "XLM",
      recipient: "GRECIPIENT",
      memo: "12345678",
      memo_type: "id",
    });
    expect(result.memo).toBe("12345678");
  });

  it("rejects a non-numeric id memo", () => {
    expect(() =>
      paymentZodSchema.parse({
        amount: 50,
        asset: "XLM",
        recipient: "GRECIPIENT",
        memo: "not-a-number",
        memo_type: "id",
      })
    ).toThrowError("memo must be a valid unsigned 64-bit integer when memo_type is id");
  });

  it("rejects invalid amounts", () => {
    expect(() =>
      paymentZodSchema.parse({
        amount: 0,
        asset: "XLM",
        recipient: "GRECIPIENT",
      })
    ).toThrowError("Amount must be a positive number");
  });

  it("accepts a native XLM amount at the minimum threshold", () => {
    const result = paymentZodSchema.parse({
      amount: MINIMUM_XLM_PAYMENT_AMOUNT,
      asset: "XLM",
      recipient: "GRECIPIENT",
    });

    expect(result.amount).toBe(MINIMUM_XLM_PAYMENT_AMOUNT);
  });

  it("rejects a native XLM amount below the minimum threshold", () => {
    expect(() =>
      paymentZodSchema.parse({
        amount: 0.0000001,
        asset: "XLM",
        recipient: "GRECIPIENT",
      })
    ).toThrowError(
      `Minimum XLM payment amount is ${MINIMUM_XLM_PAYMENT_AMOUNT}`
    );
  });

  it("does not apply the XLM minimum to non-native assets", () => {
    const result = paymentZodSchema.parse({
      amount: 0.0000001,
      asset: "EURC",
      asset_issuer: USDC_TESTNET_ISSUER,
      recipient: "GRECIPIENT",
    });

    expect(result.amount).toBe(0.0000001);
  });
});

describe("registerMerchantZodSchema", () => {
  it("parses and normalizes a valid merchant registration request", () => {
    const result = registerMerchantZodSchema.parse({
      email: " merchant@example.com ",
      password: "password123",
      business_name: " Example Co ",
      notification_email: " ops@example.com ",
    });

    expect(result).toEqual({
      email: "merchant@example.com",
      password: "password123",
      business_name: "Example Co",
      notification_email: "ops@example.com",
    });
  });

  it("rejects invalid emails", () => {
    expect(() =>
      registerMerchantZodSchema.parse({
        email: "not-an-email",
        password: "password123",
      })
    ).toThrowError("Invalid email format");
  });

  it("rejects invalid branding_config colors", () => {
    expect(() =>
      registerMerchantZodSchema.parse({
        email: "merchant@example.com",
        password: "password123",
        branding_config: {
          primary_color: "blue",
        },
      })
    ).toThrowError("primary_color must be a valid hex color");
  });

  it("accepts and passes through a metadata blob", () => {
    const result = registerMerchantZodSchema.parse({
      email: "merchant@example.com",
      password: "password123",
      metadata: { industry: "retail", country: "NG" },
    });

    expect(result.metadata).toEqual({ industry: "retail", country: "NG" });
  });

  it("rejects metadata that is not a plain object", () => {
    expect(() =>
      registerMerchantZodSchema.parse({
        email: "merchant@example.com",
        password: "password123",
        metadata: "not-an-object",
      })
    ).toThrow();
  });
});

describe("paymentSessionZodSchema", () => {
  it("accepts valid branding_overrides", () => {
    const result = paymentSessionZodSchema.parse({
      amount: 10,
      asset: "XLM",
      recipient: "GRECIPIENT",
      branding_overrides: {
        primary_color: "#abc",
        secondary_color: "#A1B2C3",
        background_color: "#000000",
      },
    });

    expect(result.branding_overrides).toEqual({
      primary_color: "#abc",
      secondary_color: "#A1B2C3",
      background_color: "#000000",
    });
  });

  it("rejects invalid hex values for branding_overrides", () => {
    expect(() =>
      paymentSessionZodSchema.parse({
        amount: 10,
        asset: "XLM",
        recipient: "GRECIPIENT",
        branding_overrides: {
          primary_color: "#12345",
        },
      })
    ).toThrowError("primary_color must be a valid hex color");
  });
});

describe("v2PaymentSessionSchema", () => {
  it("accepts a valid return memo as unsigned 64-bit integer", () => {
    const result = v2PaymentSessionSchema.parse({
      amount: 10,
      asset: "XLM",
      recipient: "GRECIPIENT",
      memo: "18446744073709551615",
      memo_type: "return",
      branding_overrides: {
        primary_color: "#abc",
      },
    });

    expect(result.memo).toBe("18446744073709551615");
    expect(result.memo_type).toBe("return");
  });

  it("rejects invalid return memo that is neither uint64 id nor 64-char hash", () => {
    expect(() =>
      v2PaymentSessionSchema.parse({
        amount: 10,
        asset: "XLM",
        recipient: "GRECIPIENT",
        memo: "bad-return-memo",
        memo_type: "return",
        branding_overrides: {
          primary_color: "#abc",
        },
      })
    ).toThrowError(
      "memo must be a valid unsigned 64-bit integer or a 32-byte hex string (64 characters) when memo_type is return"
    );
  });
});

describe("pathPaymentQuoteQuerySchema", () => {
  const assetIssuer =
    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const sourceAccount = assetIssuer;

  it("parses a valid native source asset quote request", () => {
    const result = pathPaymentQuoteQuerySchema.parse({
      source_asset: "xlm",
      source_account: sourceAccount,
    });

    expect(result).toEqual({
      source_asset: "XLM",
      source_account: sourceAccount,
    });
  });

  it("requires source_asset_issuer for non-native source assets", () => {
    expect(() =>
      pathPaymentQuoteQuerySchema.parse({
        source_asset: "USDC",
        source_account: sourceAccount,
      }),
    ).toThrowError("source_asset_issuer is required for non-native source assets");
  });

  it("rejects invalid source accounts", () => {
    expect(() =>
      pathPaymentQuoteQuerySchema.parse({
        source_asset: "XLM",
        source_account: "not-a-stellar-account",
      }),
    ).toThrowError("source_account must be a valid Stellar public key");
  });

  it("rejects source asset issuers for native XLM", () => {
    expect(() =>
      pathPaymentQuoteQuerySchema.parse({
        source_asset: "XLM",
        source_asset_issuer: assetIssuer,
        source_account: sourceAccount,
      }),
    ).toThrowError("source_asset_issuer must not be provided for native XLM");
  });

  it("accepts valid non-native source assets", () => {
    const result = pathPaymentQuoteQuerySchema.parse({
      source_asset: "USDC",
      source_asset_issuer: assetIssuer,
      source_account: sourceAccount,
    });

    expect(result).toEqual({
      source_asset: "USDC",
      source_asset_issuer: assetIssuer,
      source_account: sourceAccount,
    });
  });
});
