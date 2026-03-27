import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  formatZodError,
  MINIMUM_XLM_PAYMENT_AMOUNT,
  paymentZodSchema,
  paymentSessionZodSchema,
  registerMerchantZodSchema,
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

  it("validates hash memo format", () => {
    expect(() =>
      paymentZodSchema.parse({
        amount: 50,
        asset: "XLM",
        recipient: "GRECIPIENT",
        memo: "invalidhash",
        memo_type: "hash",
      })
    ).toThrowError("Invalid hash memo: must be exactly 64 hexadecimal characters");
  });

  it("accepts valid hash memo", () => {
    const validHash = "a".repeat(64);
    const result = paymentZodSchema.parse({
      amount: 50,
      asset: "XLM",
      recipient: "GRECIPIENT",
      memo: validHash,
      memo_type: "hash",
    });

    expect(result.memo).toBe(validHash);
    expect(result.memo_type).toBe("hash");
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
