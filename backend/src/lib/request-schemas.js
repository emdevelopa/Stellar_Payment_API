import { z } from "zod";
import { HEX_COLOR_REGEX } from "./branding.js";

const VALID_MEMO_TYPES = ["text", "id", "hash", "return"];
export const MINIMUM_XLM_PAYMENT_AMOUNT = 0.01;

function optionalTrimmedString() {
  return z.preprocess((value) => {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value === "string") {
      const trimmedValue = value.trim();
      return trimmedValue === "" ? undefined : trimmedValue;
    }

    return value;
  }, z.string().optional());
}

const amountSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const trimmedValue = value.trim();
    return trimmedValue === "" ? value : Number(trimmedValue);
  }

  return value;
}, z.number({
  required_error: "amount is required",
  invalid_type_error: "Amount must be a positive number",
}).positive("Amount must be a positive number"));

const paymentBaseSchema = z.object({
    amount: amountSchema,
    asset: z
      .string({
        required_error: "asset is required",
        invalid_type_error: "asset must be a string",
      })
      .trim()
      .min(1, "asset is required")
      .transform((value) => value.toUpperCase()),
    asset_issuer: optionalTrimmedString(),
    recipient: z
      .string({
        required_error: "recipient is required",
        invalid_type_error: "recipient must be a string",
      })
      .trim()
      .min(1, "recipient is required"),
    description: optionalTrimmedString(),
    memo: optionalTrimmedString(),
    memo_type: optionalTrimmedString().transform((value) =>
      value ? value.toLowerCase() : undefined
    ),
    webhook_url: optionalTrimmedString().refine((value) => {
      if (!value) {
        return true;
      }

      return z.string().url().safeParse(value).success;
    }, "webhook_url must be a valid URL"),
    metadata: z.unknown().optional(),
  });

function applyPaymentValidationRules(body, ctx) {
    if (body.asset === "XLM" && body.amount < MINIMUM_XLM_PAYMENT_AMOUNT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: `Minimum XLM payment amount is ${MINIMUM_XLM_PAYMENT_AMOUNT}`,
      });
    }

    if (body.asset !== "XLM" && !body.asset_issuer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["asset_issuer"],
        message: "asset_issuer is required for non-native assets",
      });
    }

    if (body.memo && !body.memo_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["memo_type"],
        message: "memo_type is required when memo is provided",
      });
    }

    if (body.memo_type && !body.memo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["memo"],
        message: "memo is required when memo_type is provided",
      });
    }

    if (body.memo_type && !VALID_MEMO_TYPES.includes(body.memo_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["memo_type"],
        message: `Invalid memo_type. Must be one of: ${VALID_MEMO_TYPES.join(", ")}`,
      });
    }
}

export const paymentZodSchema = paymentBaseSchema.superRefine(
  applyPaymentValidationRules,
);

export const registerMerchantZodSchema = z.object({
  email: z
    .string({
      required_error: "email is required",
      invalid_type_error: "email must be a string",
    })
    .trim()
    .min(1, "email is required")
    .email("Invalid email format"),
  business_name: optionalTrimmedString(),
  notification_email: optionalTrimmedString().refine((value) => {
    if (!value) {
      return true;
    }

    return z.string().email().safeParse(value).success;
  }, "Invalid notification_email format"),
  branding_config: z
    .object({
      primary_color: z
        .string()
        .trim()
        .regex(HEX_COLOR_REGEX, "primary_color must be a valid hex color")
        .optional(),
      secondary_color: z
        .string()
        .trim()
        .regex(HEX_COLOR_REGEX, "secondary_color must be a valid hex color")
        .optional(),
      background_color: z
        .string()
        .trim()
        .regex(HEX_COLOR_REGEX, "background_color must be a valid hex color")
        .optional(),
    })
    .optional(),
});

export const sessionBrandingSchema = z
  .object({
    primary_color: z
      .string()
      .trim()
      .regex(HEX_COLOR_REGEX, "primary_color must be a valid hex color")
      .optional(),
    secondary_color: z
      .string()
      .trim()
      .regex(HEX_COLOR_REGEX, "secondary_color must be a valid hex color")
      .optional(),
    background_color: z
      .string()
      .trim()
      .regex(HEX_COLOR_REGEX, "background_color must be a valid hex color")
      .optional(),
  })
  .optional();

export const paymentSessionZodSchema = paymentBaseSchema.extend({
  branding_overrides: sessionBrandingSchema,
}).superRefine(applyPaymentValidationRules);

export const webhookSettingsSchema = z.object({
  webhook_url: z.preprocess((value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    }
    return value;
  }, z
    .string()
    .url("webhook_url must be a valid URL")
    .refine(
      (val) => val.startsWith("https://"),
      "webhook_url must use HTTPS"
    )
    .optional()),
});

export function formatZodError(error) {
  return error.issues?.[0]?.message || "Validation error";
}
