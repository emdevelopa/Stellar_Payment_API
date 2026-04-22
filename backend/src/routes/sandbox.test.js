import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ────────────────────────────────────────────────────────────
const { mockInsert, mockEq } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockEq: vi.fn(),
}));

vi.mock("../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: mockInsert,
      select: vi.fn(() => ({ eq: mockEq })),
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

import { paymentCreatedCounter } from "../lib/metrics.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(body = {}) {
  return {
    body: {
      amount: 10,
      asset: "XLM",
      recipient: "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      ...body,
    },
    merchant: {
      id: "merchant-1",
      payment_limits: null,
      allowed_issuers: null,
      branding_config: null,
    },
    query: {},
    headers: {},
    get: vi.fn().mockReturnValue(null),
  };
}

function buildResponse() {
  const res = { _status: 201, _body: null };
  res.status = vi.fn((code) => { res._status = code; return res; });
  res.json = vi.fn((body) => { res._body = body; return res; });
  return res;
}

async function getCreateHandler() {
  const { default: createPaymentsRouter } = await import("./payments.js");
  const router = createPaymentsRouter();
  const layer = router.stack.find(
    (l) => l.route?.path === "/create-payment" && l.route?.methods?.post,
  );
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/create-payment — sandbox flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
  });

  it("generates a test_ prefixed ID when sandbox: true", async () => {
    const handler = await getCreateHandler();
    const req = buildRequest({ sandbox: true });
    const res = buildResponse();
    const next = vi.fn();

    await handler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];
    expect(body.payment_id).toMatch(/^test_/);
  });

  it("generates a standard UUID (no prefix) when sandbox is omitted", async () => {
    const handler = await getCreateHandler();
    const req = buildRequest();
    const res = buildResponse();

    await handler(req, res, vi.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.payment_id).not.toMatch(/^test_/);
    expect(body.payment_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("generates a standard UUID when sandbox: false", async () => {
    const handler = await getCreateHandler();
    const req = buildRequest({ sandbox: false });
    const res = buildResponse();

    await handler(req, res, vi.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.payment_id).not.toMatch(/^test_/);
  });

  it("returns sandbox: true in the response body for sandbox payments", async () => {
    const handler = await getCreateHandler();
    const req = buildRequest({ sandbox: true });
    const res = buildResponse();

    await handler(req, res, vi.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.sandbox).toBe(true);
  });

  it("returns sandbox: false in the response body for non-sandbox payments", async () => {
    const handler = await getCreateHandler();
    const req = buildRequest({ sandbox: false });
    const res = buildResponse();

    await handler(req, res, vi.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.sandbox).toBe(false);
  });

  it("stores sandbox: true in the DB insert payload for sandbox payments", async () => {
    const handler = await getCreateHandler();
    const req = buildRequest({ sandbox: true });
    const res = buildResponse();

    await handler(req, res, vi.fn());

    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted.sandbox).toBe(true);
    expect(inserted.id).toMatch(/^test_/);
  });

  it("does NOT increment paymentCreatedCounter for sandbox payments", async () => {
    const handler = await getCreateHandler();
    const req = buildRequest({ sandbox: true });
    const res = buildResponse();

    await handler(req, res, vi.fn());

    expect(paymentCreatedCounter.inc).not.toHaveBeenCalled();
  });

  it("DOES increment paymentCreatedCounter for non-sandbox payments", async () => {
    const handler = await getCreateHandler();
    const req = buildRequest();
    const res = buildResponse();

    await handler(req, res, vi.fn());

    expect(paymentCreatedCounter.inc).toHaveBeenCalledWith({ asset: "XLM" });
  });

  it("stores sandbox: false in the DB insert payload for non-sandbox payments", async () => {
    const handler = await getCreateHandler();
    const req = buildRequest();
    const res = buildResponse();

    await handler(req, res, vi.fn());

    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted.sandbox).toBe(false);
  });
});
