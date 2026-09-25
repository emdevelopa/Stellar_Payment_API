import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApiKeyAuth,
  hashPassword,
  verifyPassword,
  _resetAuthFailStateForTests,
} from "./auth.js";

function createResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

function createRequest(headers = {}, extra = {}) {
  return {
    get(name) {
      return headers[name.toLowerCase()];
    },
    ip: "1.2.3.4",
    ...extra,
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
  let merchantLookup;
  let usageRecorder;
  let verifyGatewaySignature;
  let middleware;
  let res;
  let next;

  const baseMerchant = {
    id: "merchant-123",
    email: "merchant@example.com",
    business_name: "Merchant Co",
    notification_email: "ops@example.com",
    api_key: "valid-key",
    api_key_expires_at: null,
    api_key_old: null,
    api_key_old_expires_at: null,
  };

  beforeEach(() => {
    _resetAuthFailStateForTests();
    merchantLookup = vi.fn();
    usageRecorder = vi.fn();
    verifyGatewaySignature = vi.fn(() => ({ valid: true }));
    middleware = createApiKeyAuth({ merchantLookup, usageRecorder, verifyGatewaySignature });
    res = createResponse();
    next = vi.fn();
  });

  it("rejects requests without an x-api-key header", async () => {
    const req = createRequest();

    await middleware(req, res, next);

    expect(merchantLookup).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing x-api-key header" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects requests with an invalid API key", async () => {
    merchantLookup.mockResolvedValue(null);
    const req = createRequest({ "x-api-key": "invalid-key" });

    await middleware(req, res, next);

    expect(merchantLookup).toHaveBeenCalledWith("invalid-key");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid API key" });
    expect(usageRecorder).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches the authenticated merchant to the request", async () => {
    merchantLookup.mockResolvedValue(baseMerchant);
    const req = createRequest({ "x-api-key": "  valid-key  " });

    await middleware(req, res, next);

    expect(merchantLookup).toHaveBeenCalledWith("valid-key");
    expect(req.merchant).toEqual(baseMerchant);
    expect(usageRecorder).toHaveBeenCalledWith({ merchantId: "merchant-123", req });
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("enforces signature verification when signature headers are present", async () => {
    merchantLookup.mockResolvedValue(baseMerchant);

    const req = {
      method: "POST",
      originalUrl: "/api/payments",
      body: { amount: 1 },
      ip: "1.2.3.4",
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
      clientIp: "1.2.3.4",
    });
    expect(next).toHaveBeenCalledWith();
  });

  it("does not trust a pre-populated merchant without x402 authentication", async () => {
    merchantLookup.mockResolvedValue(null);
    const req = createRequest({ "x-api-key": "invalid-key" }, { merchant: baseMerchant });

    await middleware(req, res, next);

    expect(merchantLookup).toHaveBeenCalledWith("invalid-key");
    expect(usageRecorder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("honors a merchant populated by the trusted x402 bridge", async () => {
    const req = createRequest({}, { merchant: baseMerchant, x402: { tx_hash: "tx-1" } });

    await middleware(req, res, next);

    expect(merchantLookup).not.toHaveBeenCalled();
    expect(usageRecorder).toHaveBeenCalledWith({ merchantId: baseMerchant.id, req });
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects a replay reported by the distributed signature reservation", async () => {
    merchantLookup.mockResolvedValue(baseMerchant);
    const reserveGatewaySignature = vi.fn().mockResolvedValue({
      reserved: false,
      replay: true,
    });
    middleware = createApiKeyAuth({
      merchantLookup,
      usageRecorder,
      verifyGatewaySignature,
      reserveGatewaySignature,
    });
    const req = createRequest({
      "x-api-key": "signed-api-key",
      "x-api-signature": "sha256=" + "a".repeat(64),
      "x-api-timestamp": "1713916800",
    });

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Invalid API gateway signature",
      code: "API_GATEWAY_REPLAY_DETECTED",
    });
    expect(merchantLookup).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
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
      ip: "1.2.3.4",
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
    expect(merchantLookup).not.toHaveBeenCalled();
  });

  it("requires signature headers when the middleware is configured for signed requests", async () => {
    middleware = createApiKeyAuth({
      merchantLookup,
      usageRecorder,
      verifyGatewaySignature,
      requireSignature: true,
    });
    const req = createRequest({ "x-api-key": "signed-api-key" });

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Missing required API gateway signature headers",
      code: "API_SIGNATURE_REQUIRED",
    });
    expect(verifyGatewaySignature).not.toHaveBeenCalled();
    expect(merchantLookup).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a signed request when signed auth is required", async () => {
    middleware = createApiKeyAuth({
      merchantLookup,
      usageRecorder,
      verifyGatewaySignature,
      requireSignature: true,
    });
    merchantLookup.mockResolvedValue(baseMerchant);

    const req = {
      method: "POST",
      originalUrl: "/api/merchants/rotate-api-key",
      body: { grace_period_hours: 24 },
      ip: "1.2.3.4",
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

    expect(verifyGatewaySignature).toHaveBeenCalledTimes(1);
    expect(req.merchant).toEqual(baseMerchant);
    expect(next).toHaveBeenCalledWith();
  });

  it("does not enforce signature verification when signature headers are absent", async () => {
    merchantLookup.mockResolvedValue(baseMerchant);
    const req = createRequest({ "x-api-key": "valid-key" });

    await middleware(req, res, next);

    expect(verifyGatewaySignature).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it("continues auth flow when usage tracking fails", async () => {
    merchantLookup.mockResolvedValue(baseMerchant);
    usageRecorder.mockRejectedValue(new Error("redis down"));
    const req = createRequest({ "x-api-key": "valid-key" });

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("forwards merchant lookup failures to the error handler", async () => {
    const error = new Error("DB unavailable");
    merchantLookup.mockRejectedValue(error);
    const req = createRequest({ "x-api-key": "valid-key" });

    await middleware(req, res, next);

    expect(error.status).toBe(500);
    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });

  // ── Old key rotation overlap (#765 combined query) ────────────────────────

  it("authenticates a merchant matched by old api_key during rotation overlap", async () => {
    const merchantWithOldKey = {
      ...baseMerchant,
      api_key: "new-key",
      api_key_old: "old-key",
      api_key_old_expires_at: null,
    };
    merchantLookup.mockResolvedValue(merchantWithOldKey);
    const req = createRequest({ "x-api-key": "old-key" });

    await middleware(req, res, next);

    expect(merchantLookup).toHaveBeenCalledWith("old-key");
    expect(req.merchant).toEqual(merchantWithOldKey);
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects an expired old api_key after the rotation grace period", async () => {
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    const merchantWithOldKey = {
      ...baseMerchant,
      api_key: "new-key",
      api_key_old: "old-key",
      api_key_old_expires_at: expiredAt,
    };
    merchantLookup.mockResolvedValue(merchantWithOldKey);
    const req = createRequest({ "x-api-key": "old-key" });

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "API key has expired. Please rotate to a new key.",
      code: "API_KEY_EXPIRED",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an expired current api_key", async () => {
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    merchantLookup.mockResolvedValue({ ...baseMerchant, api_key_expires_at: expiredAt });
    const req = createRequest({ "x-api-key": "valid-key" });

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "API key has expired. Please rotate to a new key.",
      code: "API_KEY_EXPIRED",
    });
  });

  // ── Auth failure rate limiting (#767) ─────────────────────────────────────

  it("returns 429 after too many failed attempts from the same IP", async () => {
    merchantLookup.mockResolvedValue(null);
    const req = createRequest({ "x-api-key": "wrong-key" });

    // Exhaust the limit (default 10)
    for (let i = 0; i < 10; i += 1) {
      await middleware(req, res, next);
    }

    res.status.mockClear();
    res.json.mockClear();
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: "Too many failed authentication attempts",
      code: "AUTH_RATE_LIMITED",
    });
  });

  it("does not rate-limit IPs with no prior failures", async () => {
    merchantLookup.mockResolvedValue(null);
    const req = createRequest({ "x-api-key": "wrong-key" });

    await middleware(req, res, next);

    // First failure: 401, not 429
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("does not count successful authentications toward the failure limit", async () => {
    merchantLookup.mockResolvedValue(baseMerchant);
    const req = createRequest({ "x-api-key": "valid-key" });

    for (let i = 0; i < 15; i += 1) {
      res = createResponse();
      await createApiKeyAuth({ merchantLookup, usageRecorder, verifyGatewaySignature })(
        req,
        res,
        next,
      );
      expect(res.status).not.toHaveBeenCalled();
    }
  });
});
