import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  formatZodError,
  MINIMUM_XLM_PAYMENT_AMOUNT,
  paymentZodSchema,
  paymentSessionZodSchema,
  registerMerchantZodSchema,
  v2PaymentSessionSchema,
} from "./request-schemas.js";

describe("paymentZodSchema", () => {
  it("parses and normalizes a valid create-payment request", () => {
    const result = paymentZodSchema.parse({
      amount: "42.5",
      asset: "usdc",
      asset_issuer: " GISSUER ",
      recipient: " GRECIPIENT ",
      memo: " Order-123 ",
      memo_type: "TEXT",
      webhook_url: "https://merchant.example/webhook",
      metadata: { orderId: "123" },
    });

    expect(result).toEqual({
      amount: 42.5,
      asset: "USDC",
      asset_issuer: "GISSUER",
      recipient: "GRECIPIENT",
      description: undefined,
      memo: "Order-123",
      memo_type: "text",
      webhook_url: "https://merchant.example/webhook",
      metadata: { orderId: "123" },
    });
  });

  it("requires asset_issuer for non-native assets", () => {
    expect(() =>
      paymentZodSchema.parse({
        amount: 50,
        asset: "USDC",
        recipient: "GRECIPIENT",
      })
    ).toThrowError("asset_issuer is required for non-native assets");
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
      asset: "USDC",
      asset_issuer: "GISSUER",
      recipient: "GRECIPIENT",
    });

    expect(result.amount).toBe(0.0000001);
  });
});

describe("registerMerchantZodSchema", () => {
  it("parses and normalizes a valid merchant registration request", () => {
    const result = registerMerchantZodSchema.parse({
      email: " merchant@example.com ",
      business_name: " Example Co ",
      notification_email: " ops@example.com ",
    });

    expect(result).toEqual({
      email: "merchant@example.com",
      business_name: "Example Co",
      notification_email: "ops@example.com",
    });
  });

  it("rejects invalid emails", () => {
    expect(() =>
      registerMerchantZodSchema.parse({
        email: "not-an-email",
      })
    ).toThrowError("Invalid email format");
  });

  it("rejects invalid branding_config colors", () => {
    expect(() =>
      registerMerchantZodSchema.parse({
        email: "merchant@example.com",
        branding_config: {
          primary_color: "blue",
        },
      })
    ).toThrowError("primary_color must be a valid hex color");
  });

  it("accepts and passes through a metadata blob", () => {
    const result = registerMerchantZodSchema.parse({
      email: "merchant@example.com",
      metadata: { industry: "retail", country: "NG" },
    });

    expect(result.metadata).toEqual({ industry: "retail", country: "NG" });
  });

  it("rejects metadata that is not a plain object", () => {
    expect(() =>
      registerMerchantZodSchema.parse({
        email: "merchant@example.com",
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
      destination_address: "GRECIPIENT",
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
        destination_address: "GRECIPIENT",
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

describe("formatZodError", () => {
  it("returns the first validation message from a zod error", () => {
    const error = new ZodError([
      {
        code: "custom",
        message: "first issue",
        path: ["email"],
      },
      {
        code: "custom",
        message: "second issue",
        path: ["notification_email"],
      },
    ]);

    expect(formatZodError(error)).toBe("first issue");
  });
});
