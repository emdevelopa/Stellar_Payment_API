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

export function formatZodError(error) {
  return error.issues?.[0]?.message || "Validation error";
}

// ─── Schema Versioning ────────────────────────────────────────────────────────

/**
 * Extract the requested API version from the request.
 * Checks X-API-Version header first, then the `v` query param.
 * Defaults to 1 (current stable).
 *
 * @param {import('express').Request} req
 * @returns {number}
 */
export function getApiVersion(req) {
  const header = req.get("X-API-Version");
  if (header) {
    const n = parseInt(header, 10);
    if (!isNaN(n)) return n;
  }
  const query = req.query?.v;
  if (query) {
    const n = parseInt(query, 10);
    if (!isNaN(n)) return n;
  }
  return 1;
}

/**
 * v1 payment body schema (legacy / current stable).
 * Uses `recipient` for the destination address.
 */
export const v1PaymentSessionSchema = paymentSessionZodSchema;

/**
 * v2 payment body schema.
 * Accepts `destination_address` as an alias for `recipient`
 * and uses `callback_url` in place of `webhook_url`.
 * The parser maps these to the internal canonical field names.
 */
const paymentBaseV2 = z.object({
  amount: paymentBaseSchema.shape.amount,
  asset: paymentBaseSchema.shape.asset,
  asset_issuer: paymentBaseSchema.shape.asset_issuer,
  destination_address: z
    .string({
      required_error: "destination_address is required",
      invalid_type_error: "destination_address must be a string",
    })
    .trim()
    .min(1, "destination_address is required"),
  description: paymentBaseSchema.shape.description,
  memo: paymentBaseSchema.shape.memo,
  memo_type: paymentBaseSchema.shape.memo_type,
  callback_url: optionalTrimmedString().refine((value) => {
    if (!value) return true;
    return z.string().url().safeParse(value).success;
  }, "callback_url must be a valid URL"),
  metadata: z.unknown().optional(),
});

export const v2PaymentSessionSchema = paymentBaseV2
  .extend({ branding_overrides: sessionBrandingSchema })
  .superRefine((body, ctx) => {
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
  });

/**
 * Parse the incoming payment body according to the requested API version.
 * Returns a normalised object using canonical internal field names.
 *
 * @param {import('express').Request} req
 * @returns {{ recipient: string, webhook_url?: string, ... }}
 */
export function parseVersionedPaymentBody(req) {
  const version = getApiVersion(req);

  if (version >= 2) {
    const parsed = v2PaymentSessionSchema.parse(req.body || {});
    return {
      ...parsed,
      recipient: parsed.destination_address,
      webhook_url: parsed.callback_url,
    };
  }

  return v1PaymentSessionSchema.parse(req.body || {});
}
