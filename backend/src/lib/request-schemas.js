import { z } from "zod";
import { HEX_COLOR_REGEX } from "./branding.js";
import { validateMemo } from "./stellar.js";

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

const amountSchema = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      const trimmedValue = value.trim();
      return trimmedValue === "" ? value : Number(trimmedValue);
    }

    return value;
  },
  z
    .number({
      required_error: "amount is required",
      invalid_type_error: "Amount must be a positive number",
    })
    .positive("Amount must be a positive number"),
);

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
    value ? value.toLowerCase() : undefined,
  ),
  webhook_url: optionalTrimmedString().refine((value) => {
    if (!value) {
      return true;
    }

      return z.string().url().safeParse(value).success;
    }, "webhook_url must be a valid URL"),
    client_id: optionalTrimmedString(),
    metadata: z.unknown().optional(),
    sandbox: z.boolean().optional(),
  });

function applyPaymentValidationRules(body, ctx) {
  const isValidUnsigned64BitInteger = (value) => {
    const parsed = (() => {
      try {
        return BigInt(value);
      } catch {
        return -1n;
      }
    })();
    return (
      parsed >= 0n && parsed <= 18446744073709551615n && /^\d+$/.test(value)
    );
  };

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

  // Validate memo format based on type
  if (body.memo && body.memo_type) {
    const memoValidation = validateMemo(body.memo, body.memo_type);
    if (!memoValidation.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["memo"],
        message: memoValidation.error,
      });
    }
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
      logo_url: z.string().trim().url("logo_url must be a valid URL").optional(),
    })
    .optional(),
  merchant_settings: z
    .object({
      send_success_emails: z.boolean().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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
    logo_url: z.string().trim().url("logo_url must be a valid URL").optional(),
  })
  .optional();

export const paymentSessionZodSchema = paymentBaseSchema
  .extend({
    branding_overrides: sessionBrandingSchema,
  })
  .superRefine(applyPaymentValidationRules);

export const v2PaymentSessionSchema = paymentSessionZodSchema;

const SAFE_HEADER_NAME_RE = /^[a-zA-Z0-9\-_]+$/;

export const VALID_WEBHOOK_EVENTS = [
  "payment.confirmed",
  "payment.failed",
  "payment.expired",
];

export const webhookSettingsSchema = z.object({
  webhook_url: z.preprocess(
    (value) => {
      if (value === null || value === undefined) return undefined;
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
      }
      return value;
    },
    z
      .string()
      .url("webhook_url must be a valid URL")
      .refine((val) => val.startsWith("https://"), "webhook_url must use HTTPS")
      .optional(),
  ),
  custom_headers: z
    .record(z.string(), z.string().min(1, "Header value must not be empty"))
    .refine(
      (obj) => Object.keys(obj).every((k) => SAFE_HEADER_NAME_RE.test(k)),
      "Header names must contain only alphanumeric characters, hyphens, or underscores",
    )
    .optional()
    .nullable(),
  subscribed_events: z
    .array(
      z.string().refine(
        (e) => VALID_WEBHOOK_EVENTS.includes(e),
        (e) => ({ message: `"${e}" is not a valid event type. Valid values: ${VALID_WEBHOOK_EVENTS.join(", ")}` }),
      ),
    )
    .optional()
    .nullable(),
});



/**
 * Helper to parse and validate payment body for session creation.
 */
export function parseVersionedPaymentBody(req) {
  return paymentSessionZodSchema.parse(req.body);
}

// ─── Shared Schemas ────────────────────────────────────────────────────────

export const paginationQuerySchema = z.object({
  page: z.preprocess(
    (val) => (val ? Number(val) : 1),
    z.number().int().min(1).default(1),
  ),
  limit: z.preprocess(
    (val) => (val ? Number(val) : 10),
    z.number().int().min(1).max(100).default(10),
  ),
});

// ─── Authentication Schemas ────────────────────────────────────────────────

export const authChallengeSchema = z.object({
  account: z
    .string({
      required_error: "Account address required",
      invalid_type_error: "Account must be a string",
    })
    .trim()
    .min(1, "destination_address is required")
    .refine(
      (val) => val.startsWith("G") && val.length === 56,
      "Invalid Stellar address",
    ),
  description: paymentBaseSchema.shape.description,
  memo: paymentBaseSchema.shape.memo,
  memo_type: paymentBaseSchema.shape.memo_type,
  callback_url: optionalTrimmedString().refine((value) => {
    if (!value) return true;
    return z.string().url().safeParse(value).success;
  }, "callback_url must be a valid URL"),
  client_id: paymentBaseSchema.shape.client_id,
  metadata: z.unknown().optional(),
});

export const authVerifySchema = z.object({
  transaction: z.string({
    required_error: "Transaction XDR required",
    invalid_type_error: "Transaction must be a string",
  }),
});

// ─── Webhook Schemas ───────────────────────────────────────────────────────

export const testWebhookSchema = z.object({
  webhook_url: z
    .string({
      required_error: "webhook_url is required",
      invalid_type_error: "webhook_url must be a string",
    })
    .url("webhook_url must be a valid URL"),
});

// ─── Payment Schemas ───────────────────────────────────────────────────────

export const refundConfirmSchema = z.object({
  tx_hash: z.string({
    required_error: "Transaction hash required",
    invalid_type_error: "Transaction hash must be a string",
  }),
});

export const pathPaymentQuoteQuerySchema = z.object({
  source_asset: z.string({
    required_error: "source_asset query parameter is required",
  }),
  source_asset_issuer: z.string().optional(),
  source_account: z.string({
    required_error: "source_account query parameter is required",
  }),
});

// ─── Metrics Schemas ───────────────────────────────────────────────────────

export const metricsVolumeQuerySchema = z.object({
  range: z
    .string()
    .transform((val) => val.toUpperCase())
    .refine((val) => ["7D", "30D", "1Y"].includes(val), {
      message: "Invalid range. Use 7D, 30D, or 1Y.",
    })
    .optional()
    .default("7D"),
});
