import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiKeyAuth, hashPassword, verifyPassword } from "./auth.js";

function createResponse() {
  return {
    status: vi.fn(),
    json: vi.fn()
  };
}

function createRequest(headers = {}) {
  return {
    get(name) {
      return headers[name.toLowerCase()];
    }
  };
}

describe("hashPassword / verifyPassword", () => {
  it("produces a bcrypt hash distinct from the plaintext", async () => {
    const hash = await hashPassword("s3cr3t!");
    expect(hash).not.toBe("s3cr3t!");
    expect(hash).toMatch(/^\$2[ab]\$/);
  });

  it("verifyPassword returns true for the correct password", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword("correct-horse", hash)).toBe(true);
  });

  it("verifyPassword returns false for a wrong password", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("two hashes of the same password differ (unique salts)", async () => {
    const h1 = await hashPassword("same");
    const h2 = await hashPassword("same");
    expect(h1).not.toBe(h2);
  });
});

describe("createApiKeyAuth", () => {
  let isMock;
  let maybeSingle;
  let eq;
  let select;
  let from;
  let supabaseClient;
  let middleware;
  let usageRecorder;
  let verifyGatewaySignature;
  let res;
  let next;

  beforeEach(() => {
    maybeSingle = vi.fn();
    isMock = vi.fn();
    const eqMock = vi.fn();
    const selectMock = vi.fn();

    const chain = {
      select: selectMock,
      eq: eqMock,
      is: isMock,
      maybeSingle,
    };

    selectMock.mockReturnValue(chain);
    eqMock.mockReturnValue(chain);
    from = vi.fn(() => chain);
    select = selectMock;
    eq = eqMock;

    isMock.mockReturnValue(chain);

    supabaseClient = { from };
    usageRecorder = vi.fn();
    verifyGatewaySignature = vi.fn(() => ({ valid: true }));
    middleware = createApiKeyAuth({
      supabaseClient,
      usageRecorder,
      verifyGatewaySignature,
    });
    res = createResponse();
    res.status.mockReturnValue(res);
    next = vi.fn();
  });

  it("rejects requests without an x-api-key header", async () => {
    const req = createRequest();

    await middleware(req, res, next);

    expect(from).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing x-api-key header" });
    expect(next).not.toHaveBeenCalled();
    expect(verifyGatewaySignature).not.toHaveBeenCalled();
  });

  it("rejects requests with an invalid API key", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const req = createRequest({ "x-api-key": "invalid-key" });

    await middleware(req, res, next);

    expect(from).toHaveBeenCalledWith("merchants");
    expect(select).toHaveBeenCalledWith(
      "id, email, business_name, notification_email, branding_config, merchant_settings, webhook_secret, webhook_secret_old, webhook_secret_expiry, webhook_version, payment_limits, api_key, api_key_expires_at, api_key_old, api_key_old_expires_at",
    );
    expect(eq).toHaveBeenCalledWith("api_key", "invalid-key");
    expect(isMock).toHaveBeenCalledWith("deleted_at", null);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid API key" });
    expect(usageRecorder).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches the authenticated merchant to the request", async () => {
    const merchant = {
      id: "merchant-123",
      email: "merchant@example.com",
      business_name: "Merchant Co",
      notification_email: "ops@example.com"
    };
    maybeSingle.mockResolvedValue({ data: merchant, error: null });
    const req = createRequest({ "x-api-key": "  valid-key  " });

    await middleware(req, res, next);

    expect(eq).toHaveBeenCalledWith("api_key", "valid-key");
    expect(isMock).toHaveBeenCalledWith("deleted_at", null);
    expect(req.merchant).toEqual(merchant);
    expect(usageRecorder).toHaveBeenCalledWith({
      merchantId: "merchant-123",
      req,
    });
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(verifyGatewaySignature).not.toHaveBeenCalled();
  });

  it("enforces signature verification when signature headers are present", async () => {
    const merchant = {
      id: "merchant-123",
      email: "merchant@example.com",
    };
    maybeSingle.mockResolvedValue({ data: merchant, error: null });

    const req = {
      method: "POST",
      originalUrl: "/api/payments",
      body: { amount: 1 },
      get(name) {
        const headers = {
          "x-api-key": "signed-api-key",
          "x-api-signature": "sha256=abcd",
          "x-api-timestamp": "1713916800",
        };
        return headers[String(name).toLowerCase()];
      },
    };

    await middleware(req, res, next);

    expect(verifyGatewaySignature).toHaveBeenCalledWith({
      secret: "signed-api-key",
      method: "POST",
      path: "/api/payments",
      timestampHeader: "1713916800",
      signatureHeader: "sha256=abcd",
      body: { amount: 1 },
    });
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects request when gateway signature verification fails", async () => {
    verifyGatewaySignature.mockReturnValue({
      valid: false,
      reason: "Request signature verification failed",
    });

    const req = {
      method: "GET",
      originalUrl: "/api/metrics/summary",
      body: {},
      get(name) {
        const headers = {
          "x-api-key": "signed-api-key",
          "x-api-signature": "sha256=bad",
          "x-api-timestamp": "1713916800",
        };
        return headers[String(name).toLowerCase()];
      },
    };

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Invalid API gateway signature",
      code: "API_SIGNATURE_INVALID",
      reason: "Request signature verification failed",
    });
    expect(next).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("does not enforce signature verification when signature headers are absent", async () => {
    const merchant = {
      id: "merchant-123",
      email: "merchant@example.com",
      business_name: "Merchant Co",
      notification_email: "ops@example.com",
    };
    maybeSingle.mockResolvedValue({ data: merchant, error: null });

    const req = createRequest({ "x-api-key": "valid-key" });

    await middleware(req, res, next);

    expect(verifyGatewaySignature).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it("continues auth flow when usage tracking fails", async () => {
    const merchant = {
      id: "merchant-123",
      email: "merchant@example.com",
      business_name: "Merchant Co",
      notification_email: "ops@example.com",
    };

    maybeSingle.mockResolvedValue({ data: merchant, error: null });
    usageRecorder.mockRejectedValue(new Error("redis down"));
    const req = createRequest({ "x-api-key": "valid-key" });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("forwards Supabase lookup failures to the error handler", async () => {
    const error = new Error("Supabase unavailable");
    maybeSingle.mockResolvedValue({ data: null, error });
    const req = createRequest({ "x-api-key": "valid-key" });

    await middleware(req, res, next);

    expect(error.status).toBe(500);
    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});
