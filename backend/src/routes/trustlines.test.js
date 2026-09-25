import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import trustlinesRouter, { _resetRateLimiters } from "./trustlines.js";

const {
  mockVerifyTrustlineTransaction,
  mockLogTrustlineVerification,
  mockGetMerchantAllowedAssets,
  mockGetMerchantTrustlineConfig,
  mockRequireApiKeyAuth,
  mockAuthMiddleware,
  mockConnectRedisClient,
  mockCreateTrustlineRateLimits,
  mockIsValidAssetCode,
  mockIsValidStellarAccountId,
} = vi.hoisted(() => ({
  mockVerifyTrustlineTransaction: vi.fn(),
  mockLogTrustlineVerification: vi.fn(),
  mockGetMerchantAllowedAssets: vi.fn(),
  mockGetMerchantTrustlineConfig: vi.fn(),
  mockAuthMiddleware: (req, _res, next) => {
    req.merchant = { id: "merchant_123", metadata: { tier: "basic" } };
    next();
  },
  mockRequireApiKeyAuth: vi.fn(() => mockAuthMiddleware),
  mockConnectRedisClient: vi.fn(),
  mockCreateTrustlineRateLimits: vi.fn(),
  mockIsValidAssetCode: vi.fn(),
  mockIsValidStellarAccountId: vi.fn(),
}));

vi.mock("../lib/trustline-manager.js", () => ({
  trustlineManager: {
    verifyTrustlineTransaction: mockVerifyTrustlineTransaction,
    getMerchantTrustlineConfig: mockGetMerchantTrustlineConfig,
    queryOptimizer: {
      logTrustlineVerification: mockLogTrustlineVerification,
      getMerchantAllowedAssets: mockGetMerchantAllowedAssets,
    },
    signatureVerifier: {
      verificationCache: new Map(),
    },
    errorRecovery: {
      isCircuitBreakerOpen: vi.fn(() => false),
    },
  },
  createTrustlineRateLimits: mockCreateTrustlineRateLimits,
}));

vi.mock("../lib/auth.js", () => ({
  requireApiKeyAuth: mockRequireApiKeyAuth,
}));

vi.mock("../lib/redis.js", () => ({
  connectRedisClient: mockConnectRedisClient,
}));

vi.mock("../lib/stellar.js", () => ({
  isValidAssetCode: mockIsValidAssetCode,
  isValidStellarAccountId: mockIsValidStellarAccountId,
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/trustlines", trustlinesRouter);
  return app;
}

describe("Trustline routes", () => {
  // Helper that returns a 429-blocking limiter for a specific slot
  function blockingLimiter(slot) {
    const pass = (_req, _res, next) => next();
    const block = (_req, res) =>
      res.status(429).json({ error: "Rate limit exceeded", code: "TEST_LIMIT" });
    return {
      operations: slot === "operations" ? block : pass,
      verifications: slot === "verifications" ? block : pass,
      burst: slot === "burst" ? block : pass,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireApiKeyAuth.mockReturnValue(mockAuthMiddleware);
    mockConnectRedisClient.mockResolvedValue({});
    mockCreateTrustlineRateLimits.mockReturnValue({
      operations: (_req, _res, next) => next(),
      verifications: (_req, _res, next) => next(),
      burst: (_req, _res, next) => next(),
    });
    mockIsValidAssetCode.mockReturnValue(true);
    mockIsValidStellarAccountId.mockReturnValue(true);
    mockGetMerchantAllowedAssets.mockRejectedValue(new Error("db unavailable"));
  });

  it("verifies trustline transactions and forwards skipCache to the manager", async () => {
    mockVerifyTrustlineTransaction.mockResolvedValue({
      valid: true,
      reason: "ok",
      trustlineSpecific: true,
    });
    mockLogTrustlineVerification.mockResolvedValue({ rows: [] });

    const response = await request(createApp())
      .post(`/trustlines/verify/${"a".repeat(64)}`)
      .send({ expectedOperation: "changeTrust", skipCache: true });

    expect(response.status).toBe(200);
    expect(mockVerifyTrustlineTransaction).toHaveBeenCalledWith("a".repeat(64), {
      expectedOperation: "changeTrust",
      skipCache: true,
    });
    expect(mockLogTrustlineVerification).toHaveBeenCalledWith({
      merchantId: "merchant_123",
      txHash: "a".repeat(64),
      verification: expect.objectContaining({ valid: true }),
    });
  });

  it("exposes the trustline health endpoint", async () => {
    const response = await request(createApp()).get("/trustlines/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "degraded",
      components: {
        signatureVerifier: "healthy",
        rateLimiter: "healthy",
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting – Route-level tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Trustline routes – rate limiting enforcement", () => {
  beforeEach(() => {
    // Reset the cached rate-limiter so each test controls which limiters fire
    _resetRateLimiters();
    vi.clearAllMocks();
    mockRequireApiKeyAuth.mockReturnValue((req, _res, next) => {
      req.merchant = { id: "merchant_123", metadata: { tier: "basic" } };
      next();
    });
    mockConnectRedisClient.mockResolvedValue({});
    mockIsValidAssetCode.mockReturnValue(true);
    mockIsValidStellarAccountId.mockReturnValue(true);
  });

  function blockingLimiter(slot) {
    const pass = (_req, _res, next) => next();
    const block = (_req, res) =>
      res.status(429).json({ error: "Rate limit exceeded", code: "TEST_LIMIT" });
    return {
      operations: slot === "operations" ? block : pass,
      verifications: slot === "verifications" ? block : pass,
      burst: slot === "burst" ? block : pass,
    };
  }

  it("POST /verify/:txHash returns 429 when verification limiter triggers", async () => {
    mockCreateTrustlineRateLimits.mockReturnValue(blockingLimiter("verifications"));

    const response = await request(createApp())
      .post(`/trustlines/verify/${"a".repeat(64)}`)
      .send({ expectedOperation: "changeTrust" });

    expect(response.status).toBe(429);
    expect(response.body.code).toBe("TEST_LIMIT");
  });

  it("POST /verify/:txHash returns 429 when burst limiter triggers", async () => {
    mockCreateTrustlineRateLimits.mockReturnValue(blockingLimiter("burst"));

    const response = await request(createApp())
      .post(`/trustlines/verify/${"b".repeat(64)}`)
      .send({ expectedOperation: "changeTrust" });

    expect(response.status).toBe(429);
  });

  it("GET /trustlines/config returns 429 when operations limiter triggers", async () => {
    mockCreateTrustlineRateLimits.mockReturnValue(blockingLimiter("operations"));

    const response = await request(createApp()).get("/trustlines/config");

    expect(response.status).toBe(429);
  });

  it("GET /trustlines/config returns 429 when burst limiter triggers", async () => {
    mockCreateTrustlineRateLimits.mockReturnValue(blockingLimiter("burst"));

    const response = await request(createApp()).get("/trustlines/config");

    expect(response.status).toBe(429);
  });

  it("GET /trustlines/stats returns 429 when burst limiter triggers", async () => {
    mockCreateTrustlineRateLimits.mockReturnValue(blockingLimiter("burst"));

    const response = await request(createApp()).get("/trustlines/stats");

    expect(response.status).toBe(429);
  });

  it("POST /validate-asset returns 429 when burst limiter triggers", async () => {
    mockCreateTrustlineRateLimits.mockReturnValue(blockingLimiter("burst"));

    const response = await request(createApp())
      .post("/trustlines/validate-asset")
      .send({ assetCode: "USDC" });

    expect(response.status).toBe(429);
  });

  it("POST /validate-asset returns 429 when operations limiter triggers", async () => {
    mockCreateTrustlineRateLimits.mockReturnValue(blockingLimiter("operations"));

    const response = await request(createApp())
      .post("/trustlines/validate-asset")
      .send({ assetCode: "USDC" });

    expect(response.status).toBe(429);
  });

  it("GET /trustlines/assets/:assetCode/payments returns 429 when burst limiter triggers", async () => {
    mockCreateTrustlineRateLimits.mockReturnValue(blockingLimiter("burst"));

    const response = await request(createApp()).get(
      "/trustlines/assets/USDC/payments",
    );

    expect(response.status).toBe(429);
  });

  it("all rate limiters pass through for normal requests", async () => {
    mockVerifyTrustlineTransaction.mockResolvedValue({
      valid: true,
      reason: "ok",
      trustlineSpecific: true,
    });
    mockLogTrustlineVerification.mockResolvedValue({ rows: [] });
    mockCreateTrustlineRateLimits.mockReturnValue({
      operations: (_req, _res, next) => next(),
      verifications: (_req, _res, next) => next(),
      burst: (_req, _res, next) => next(),
    });

    const response = await request(createApp())
      .post(`/trustlines/verify/${"c".repeat(64)}`)
      .send({ expectedOperation: "changeTrust" });

    expect(response.status).toBe(200);
    expect(response.body.verification.valid).toBe(true);
  });
});
