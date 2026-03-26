import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  formatZodError,
  paymentZodSchema,
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

  it("rejects invalid amounts", () => {
    expect(() =>
      paymentZodSchema.parse({
        amount: 0,
        asset: "XLM",
        recipient: "GRECIPIENT",
      })
    ).toThrowError("Amount must be a positive number");
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
