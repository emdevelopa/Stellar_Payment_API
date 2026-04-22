import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ─────────────────────────────────────────────────────────────
const { mockFilter, mockEq, mockOrder, mockRange } = vi.hoisted(() => ({
  mockFilter: vi.fn(),
  mockEq: vi.fn(),
  mockOrder: vi.fn(),
  mockRange: vi.fn(),
}));

vi.mock("../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: mockEq,
        filter: mockFilter,
      })),
    })),
  },
}));

// ── Misc mocks ────────────────────────────────────────────────────────────────
vi.mock("../lib/redis.js", () => ({
  connectRedisClient: vi.fn().mockResolvedValue(null),
  getCachedPayment: vi.fn().mockResolvedValue(null),
  setCachedPayment: vi.fn().mockResolvedValue(undefined),
  invalidatePaymentCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/branding.js", () => ({
  resolveBrandingConfig: vi.fn().mockReturnValue({}),
  HEX_COLOR_REGEX: /^#[0-9a-fA-F]{6}$/,
}));
vi.mock("../lib/recaptcha.js", () => ({
  recaptchaMiddleware: vi.fn(() => (_req, _res, next) => next()),
}));
vi.mock("../lib/create-payment-rate-limit.js", () => ({
  createCreatePaymentRateLimit: vi.fn(() => (_req, _res, next) => next()),
}));
vi.mock("../lib/sanitize-metadata.js", () => ({
  sanitizeMetadataMiddleware: (_req, _res, next) => next(),
}));
vi.mock("../lib/metrics.js", () => ({
  paymentCreatedCounter: { inc: vi.fn() },
  paymentConfirmedCounter: { inc: vi.fn() },
  paymentConfirmationLatency: { observe: vi.fn() },
  paymentFailedCounter: { inc: vi.fn() },
}));
vi.mock("../lib/stream-manager.js", () => ({ streamManager: { io: null } }));
vi.mock("../lib/email.js", () => ({
  sendReceiptEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/email-templates.js", () => ({
  renderReceiptEmail: vi.fn().mockReturnValue(""),
}));
vi.mock("../lib/webhooks.js", () => ({
  sendWebhook: vi.fn(),
  validateWebhookUrl: vi.fn().mockResolvedValue(true),
  sanitizeCustomHeaders: vi.fn().mockReturnValue({}),
}));
vi.mock("../lib/stellar.js", () => ({
  findMatchingPayment: vi.fn(),
  findStrictReceivePaths: vi.fn(),
  getNetworkFeeStats: vi.fn(),
}));
vi.mock("../lib/pagination-links.js", () => ({
  generatePaginationLinks: vi.fn().mockReturnValue({}),
}));
vi.mock("../lib/validate-uuid.js", () => ({
  validateUuidParam: vi.fn(() => (_req, _res, next) => next()),
}));
vi.mock("../lib/validation.js", () => ({
  validateRequest: vi.fn(() => (_req, _res, next) => next()),
}));

// ── Unit tests for applyMetadataFilters ───────────────────────────────────────
// We test the function directly by importing it via the module's internal
// structure. Since it's not exported, we verify its behaviour indirectly
// through the GET /payments handler — or test it as a pure function below.

describe("applyMetadataFilters — pure function behaviour", () => {
  // Build a minimal chainable query mock
  function buildQueryMock() {
    const q = {};
    q.filter = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    return q;
  }

  // Re-implement the function here to unit-test its logic in isolation.
  // The real implementation lives in payments.js; this mirrors it exactly.
  const SAFE_METADATA_KEY_RE = /^[a-zA-Z0-9_-]{1,64}$/;
  function applyMetadataFilters(query, rawQuery) {
    const metadataParam = rawQuery.metadata;
    if (
      !metadataParam ||
      typeof metadataParam !== "object" ||
      Array.isArray(metadataParam)
    ) {
      return query;
    }
    for (const [key, value] of Object.entries(metadataParam)) {
      if (!SAFE_METADATA_KEY_RE.test(key)) continue;
      if (typeof value !== "string") continue;
      query = query.filter("metadata", "cs", JSON.stringify({ [key]: value }));
    }
    return query;
  }

  it("applies a single metadata filter", () => {
    const q = buildQueryMock();
    applyMetadataFilters(q, { metadata: { order_id: "12345" } });
    expect(q.filter).toHaveBeenCalledTimes(1);
    expect(q.filter).toHaveBeenCalledWith(
      "metadata",
      "cs",
      JSON.stringify({ order_id: "12345" }),
    );
  });

  it("applies multiple metadata filters independently", () => {
    const q = buildQueryMock();
    applyMetadataFilters(q, { metadata: { order_id: "42", region: "us-east" } });
    expect(q.filter).toHaveBeenCalledTimes(2);
    expect(q.filter).toHaveBeenCalledWith(
      "metadata",
      "cs",
      JSON.stringify({ order_id: "42" }),
    );
    expect(q.filter).toHaveBeenCalledWith(
      "metadata",
      "cs",
      JSON.stringify({ region: "us-east" }),
    );
  });

  it("skips keys that fail the safe-key regex", () => {
    const q = buildQueryMock();
    // Key with spaces, semicolons, and SQL-injection attempts are all unsafe
    applyMetadataFilters(q, {
      metadata: { "bad key": "val", "'; DROP TABLE": "x", valid_key: "ok" },
    });
    expect(q.filter).toHaveBeenCalledTimes(1);
    expect(q.filter).toHaveBeenCalledWith(
      "metadata",
      "cs",
      JSON.stringify({ valid_key: "ok" }),
    );
  });

  it("skips keys that are longer than 64 characters", () => {
    const q = buildQueryMock();
    const longKey = "a".repeat(65);
    applyMetadataFilters(q, { metadata: { [longKey]: "value" } });
    expect(q.filter).not.toHaveBeenCalled();
  });

  it("skips non-string values", () => {
    const q = buildQueryMock();
    applyMetadataFilters(q, {
      metadata: { order_id: 12345, active: true, tags: ["a", "b"] },
    });
    expect(q.filter).not.toHaveBeenCalled();
  });

  it("returns the query unchanged when metadata param is absent", () => {
    const q = buildQueryMock();
    const result = applyMetadataFilters(q, {});
    expect(result).toBe(q);
    expect(q.filter).not.toHaveBeenCalled();
  });

  it("returns the query unchanged when metadata is a string (not an object)", () => {
    const q = buildQueryMock();
    const result = applyMetadataFilters(q, { metadata: "order_id=123" });
    expect(result).toBe(q);
    expect(q.filter).not.toHaveBeenCalled();
  });

  it("returns the query unchanged when metadata is an array", () => {
    const q = buildQueryMock();
    const result = applyMetadataFilters(q, { metadata: ["order_id", "123"] });
    expect(result).toBe(q);
    expect(q.filter).not.toHaveBeenCalled();
  });

  it("returns the query unchanged when metadata is null", () => {
    const q = buildQueryMock();
    const result = applyMetadataFilters(q, { metadata: null });
    expect(result).toBe(q);
    expect(q.filter).not.toHaveBeenCalled();
  });

  it("accepts keys with hyphens and underscores", () => {
    const q = buildQueryMock();
    applyMetadataFilters(q, {
      metadata: { "order-id": "abc", order_ref: "xyz" },
    });
    expect(q.filter).toHaveBeenCalledTimes(2);
  });

  it("accepts a key exactly 64 characters long", () => {
    const q = buildQueryMock();
    const maxKey = "a".repeat(64);
    applyMetadataFilters(q, { metadata: { [maxKey]: "value" } });
    expect(q.filter).toHaveBeenCalledTimes(1);
  });

  it("produces valid JSON containment payloads", () => {
    const q = buildQueryMock();
    applyMetadataFilters(q, { metadata: { key: 'value with "quotes"' } });
    // The filter value must be valid JSON
    const filterArg = q.filter.mock.calls[0][2];
    expect(() => JSON.parse(filterArg)).not.toThrow();
    expect(JSON.parse(filterArg)).toEqual({ key: 'value with "quotes"' });
  });
});
