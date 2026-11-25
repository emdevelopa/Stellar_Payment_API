import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const eq = vi.fn();
const select = vi.fn();
const update = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ update }));

vi.mock("../lib/supabase.js", () => ({
  supabase: { from },
}));

function createResponse() {
  return {
    status: vi.fn(),
    json: vi.fn(),
  };
}

function getRotateWebhookSecretHandler(router) {
  const layer = router.stack.find(
    (entry) =>
      entry.route?.path === "/merchants/rotate-webhook-secret" &&
      entry.route?.methods?.post,
  );

  if (!layer) {
    throw new Error("rotate-webhook-secret route not found");
  }

  // Find the actual handler: it's typically the last one in the route's stack,
  // following any middlewares like validateRequest.
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

describe("POST /api/merchants/rotate-webhook-secret", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WEBHOOK_SECRET_ROTATION_GRACE_HOURS;
    // The rotation is a compare-and-swap: update().eq(id).eq(col, old).select("id").
    select.mockResolvedValue({ data: [{ id: "merchant-123" }], error: null });
    eq.mockImplementation(() => ({ eq, is: eq, select }));
  });

  it("rotates secret with default 24h grace period", async () => {
    const { default: createMerchantsRouter } = await import("./merchants.js");
    const router = createMerchantsRouter();
    const handler = getRotateWebhookSecretHandler(router);

    const req = {
      body: {},
      merchant: {
        id: "merchant-123",
        webhook_secret: "whsec_old_secret",
      },
    };

    const res = createResponse();
    const next = vi.fn();

    const nowBefore = Date.now();
    await handler(req, res, next);
    const nowAfter = Date.now();

    expect(from).toHaveBeenCalledWith("merchants");
    expect(update).toHaveBeenCalledTimes(1);

    const updatePayload = update.mock.calls[0][0];
    expect(updatePayload.webhook_secret_old).toBe("whsec_old_secret");
    expect(updatePayload.webhook_secret).toMatch(/^whsec_[a-f0-9]{64}$/);

    const expiry = new Date(updatePayload.webhook_secret_expiry).getTime();
    const lowerBound = nowBefore + 24 * 60 * 60 * 1000;
    const upperBound = nowAfter + 24 * 60 * 60 * 1000 + 1_000;
    expect(expiry).toBeGreaterThanOrEqual(lowerBound);
    expect(expiry).toBeLessThanOrEqual(upperBound);

    expect(eq).toHaveBeenCalledWith("id", "merchant-123");
    // Guarded by the credential that was read, so a stale rotation cannot clobber a newer one.
    expect(eq).toHaveBeenCalledWith("webhook_secret", "whsec_old_secret");
    expect(res.json).toHaveBeenCalledTimes(1);

    const responsePayload = res.json.mock.calls[0][0];
    expect(responsePayload.webhook_secret).toMatch(/^whsec_[a-f0-9]{64}$/);
    expect(responsePayload.grace_period_hours).toBe(24);
    expect(next).not.toHaveBeenCalled();
  });

  it("uses request grace period override", async () => {
    const { default: createMerchantsRouter } = await import("./merchants.js");
    const router = createMerchantsRouter();
    const handler = getRotateWebhookSecretHandler(router);

    const req = {
      body: { grace_period_hours: 2 },
      merchant: {
        id: "merchant-123",
        webhook_secret: "whsec_old_secret",
      },
    };

    const res = createResponse();
    const next = vi.fn();

    const nowBefore = Date.now();
    await handler(req, res, next);
    const nowAfter = Date.now();

    const updatePayload = update.mock.calls[0][0];
    const expiry = new Date(updatePayload.webhook_secret_expiry).getTime();
    const lowerBound = nowBefore + 2 * 60 * 60 * 1000;
    const upperBound = nowAfter + 2 * 60 * 60 * 1000 + 1_000;

    expect(expiry).toBeGreaterThanOrEqual(lowerBound);
    expect(expiry).toBeLessThanOrEqual(upperBound);

    const responsePayload = res.json.mock.calls[0][0];
    expect(responsePayload.grace_period_hours).toBe(2);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects unsigned requests before rotating the secret", async () => {
    const { default: createMerchantsRouter } = await import("./merchants.js");
    const app = express();
    app.use(express.json());
    app.use("/api", createMerchantsRouter());

    const response = await request(app)
      .post("/api/merchants/rotate-webhook-secret")
      .send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Missing x-api-key header" });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("merchant route authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("protects webhook settings behind API key auth", async () => {
    const { default: createMerchantsRouter } = await import("./merchants.js");
    const app = express();
    app.use(express.json());
    app.use("/api", createMerchantsRouter());

    const response = await request(app).get("/api/webhook-settings");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Missing x-api-key header" });
  });
});

describe("concurrent credential rotation (#1772)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resetLocalSessionLocksForTests } = await import("../lib/payment-session-lock.js");
    resetLocalSessionLocksForTests();
    select.mockResolvedValue({ data: [{ id: "merchant-123" }], error: null });
    eq.mockImplementation(() => ({ eq, is: eq, select }));
  });

  async function rotateHandler() {
    const { default: createMerchantsRouter } = await import("./merchants.js");
    return getRotateWebhookSecretHandler(createMerchantsRouter());
  }

  function makeReq() {
    return { body: {}, merchant: { id: "merchant-123", webhook_secret: "whsec_old_secret" } };
  }

  it("returns 409 to the caller whose credential changed underneath it, without leaking secrets", async () => {
    select.mockResolvedValue({ data: [], error: null });
    const handler = await rotateHandler();
    const res = createResponse();
    const next = vi.fn();

    await handler(makeReq(), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.status).toBe(409);
    expect(err.code).toBe("MERCHANT_CREDENTIAL_CONFLICT");
    expect(JSON.stringify({ message: err.message })).not.toMatch(/whsec_/);
  });

  it("rejects a second rotation that arrives while the first is in flight", async () => {
    let release;
    select.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: [{ id: "merchant-123" }], error: null });
        }),
    );
    const handler = await rotateHandler();

    const firstRes = createResponse();
    const firstNext = vi.fn();
    const first = handler(makeReq(), firstRes, firstNext);
    await new Promise((r) => setTimeout(r, 20)); // let the first acquire the lock

    const secondRes = createResponse();
    const secondNext = vi.fn();
    await handler(makeReq(), secondRes, secondNext);

    expect(secondRes.json).not.toHaveBeenCalled();
    expect(secondNext.mock.calls[0][0]).toMatchObject({ status: 409, code: "MERCHANT_LIFECYCLE_BUSY" });

    release();
    await first;
    expect(firstRes.json).toHaveBeenCalledTimes(1);
    expect(firstNext).not.toHaveBeenCalled();
    // Only the winner reached the database.
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("surfaces a database failure as a 500 and releases the lock", async () => {
    select.mockResolvedValueOnce({ data: null, error: new Error("db down") });
    const handler = await rotateHandler();
    const next = vi.fn();

    await handler(makeReq(), createResponse(), next);
    expect(next.mock.calls[0][0].status).toBe(500);

    const res = createResponse();
    await handler(makeReq(), res, vi.fn());
    expect(res.json).toHaveBeenCalledTimes(1); // lock was released, retry succeeds
  });
});
