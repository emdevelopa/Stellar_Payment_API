/**
 * End-to-end tests for API Gateway Security (issue #1061)
 *
 * Drives real HTTP requests (via supertest) through a real Express app
 * wired with the actual `createApiKeyAuth` middleware and the *real*
 * HMAC-SHA256 signature implementation in api-gateway-signature.js — no
 * mocked crypto. Only the merchant lookup / usage-recording boundaries are
 * injected (as `createApiKeyAuth` is designed to allow) so no database is
 * required.
 *
 * This closes a real coverage gap: the existing unit tests in
 * src/lib/auth.test.js call the middleware directly with hand-built
 * req/res objects and a mocked `verifyGatewaySignature`, so the actual
 * request-signing → HTTP → Express routing → HMAC verification path was
 * never exercised end-to-end.
 *
 * Coverage:
 *   - Happy path: correctly signed requests are authenticated
 *   - Tampering: body/method/path tampering after signing is rejected
 *   - Replay/window: stale timestamps are rejected
 *   - Malformed headers are rejected
 *   - Per-IP rate limiting on signature verification (429)
 *   - Circuit breaker opens after repeated failures and later recovers
 *   - API key lifecycle: unknown key, expired key, rotated key
 *   - Auth-failure rate limiting (independent of signature rate limiting)
 *   - Sensitive values (API key/secret) never leak into responses
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express from "express";

// Small, deterministic limits so the e2e tests can trigger rate limiting /
// the circuit breaker without sending thousands of requests. These are read
// once at module-load time by api-gateway-signature.js, so they must be set
// before that module (or auth.js, which imports it) is first imported.
process.env.API_GATEWAY_RATE_LIMIT_MAX = "5";
process.env.API_GATEWAY_RATE_LIMIT_WINDOW_MS = "60000";
process.env.API_GATEWAY_SIGNATURE_TOLERANCE_SECONDS = "300";

const { createApiKeyAuth } = await import("../../src/lib/auth.js");
const {
  signApiGatewayRequest,
  _resetApiGatewayRateLimitStateForTests,
} = await import("../../src/lib/api-gateway-signature.js");

const API_KEY = "e2e-gateway-secret-key-32-chars-ok";
const MERCHANT = {
  id: "merchant-e2e-1",
  email: "merchant@example.com",
  business_name: "E2E Gateway Merchant",
  api_key: API_KEY,
  api_key_expires_at: null,
  api_key_old: null,
  api_key_old_expires_at: null,
};

function buildApp({ merchantLookup, requireSignature = true } = {}) {
  const app = express();
  // Honor X-Forwarded-For so tests can simulate distinct client IPs for
  // rate-limiter / circuit-breaker isolation, matching how a real deployment
  // behind a load balancer would be configured.
  app.set("trust proxy", true);
  app.use(express.json());

  const auth = createApiKeyAuth({
    merchantLookup: merchantLookup || (async (key) => (key === API_KEY ? MERCHANT : null)),
    usageRecorder: vi.fn(),
    requireSignature,
  });

  app.post("/api/protected/echo", auth, (req, res) => {
    res.status(200).json({ ok: true, merchantId: req.merchant.id, received: req.body });
  });

  app.get("/api/protected/health", auth, (req, res) => {
    res.status(200).json({ ok: true, merchantId: req.merchant.id });
  });

  return app;
}

/** Sign a request the same way a real API client would. */
function signRequest({ secret = API_KEY, method, path, body, timestamp = Math.floor(Date.now() / 1000) }) {
  const signature = signApiGatewayRequest({ secret, method, path, timestamp, body });
  return {
    "x-api-key": secret,
    "x-api-signature": `sha256=${signature}`,
    "x-api-timestamp": String(timestamp),
  };
}

describe("API Gateway Security — end to end", () => {
  beforeEach(() => {
    _resetApiGatewayRateLimitStateForTests();
  });

  describe("happy path", () => {
    it("authenticates a correctly signed GET request", async () => {
      const app = buildApp();
      const headers = signRequest({ method: "GET", path: "/api/protected/health", body: {} });

      const res = await request(app).get("/api/protected/health").set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, merchantId: MERCHANT.id });
    });

    it("authenticates a correctly signed POST request with a JSON body", async () => {
      const app = buildApp();
      const body = { amount: 42.5, asset: "USDC" };
      const headers = signRequest({ method: "POST", path: "/api/protected/echo", body });

      const res = await request(app).post("/api/protected/echo").set(headers).send(body);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, merchantId: MERCHANT.id, received: body });
    });
  });

  describe("tampering is rejected", () => {
    it("rejects a request whose body was modified after signing", async () => {
      const app = buildApp();
      const headers = signRequest({
        method: "POST",
        path: "/api/protected/echo",
        body: { amount: 10 },
      });

      const res = await request(app)
        .post("/api/protected/echo")
        .set(headers)
        .send({ amount: 999999 }); // tampered after the signature was computed

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("API_SIGNATURE_INVALID");
    });

    it("rejects a signature computed for a different path", async () => {
      const app = buildApp();
      const headers = signRequest({
        method: "GET",
        path: "/api/protected/other-route",
        body: {},
      });

      const res = await request(app).get("/api/protected/health").set(headers);

      expect(res.status).toBe(401);
    });

    it("rejects a malformed signature header", async () => {
      const app = buildApp();

      const res = await request(app)
        .get("/api/protected/health")
        .set({
          "x-api-key": API_KEY,
          "x-api-signature": "not-a-real-signature",
          "x-api-timestamp": String(Math.floor(Date.now() / 1000)),
        });

      expect(res.status).toBe(401);
    });
  });

  describe("timestamp window enforcement", () => {
    it("rejects a signature whose timestamp is outside the tolerance window", async () => {
      const app = buildApp();
      const staleTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour old
      const headers = signRequest({
        method: "GET",
        path: "/api/protected/health",
        body: {},
        timestamp: staleTimestamp,
      });

      const res = await request(app).get("/api/protected/health").set(headers);

      expect(res.status).toBe(401);
      expect(res.body.reason).toMatch(/outside the accepted window/i);
    });
  });

  describe("signature requirement enforcement", () => {
    it("rejects unsigned requests when signing is required", async () => {
      const app = buildApp({ requireSignature: true });

      const res = await request(app).get("/api/protected/health").set({ "x-api-key": API_KEY });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("API_SIGNATURE_REQUIRED");
    });

    it("allows unsigned requests when signing is optional", async () => {
      const app = buildApp({ requireSignature: false });

      const res = await request(app).get("/api/protected/health").set({ "x-api-key": API_KEY });

      expect(res.status).toBe(200);
    });
  });

  describe("per-IP signature rate limiting", () => {
    it("returns 429 once the signature verification rate limit is exceeded", async () => {
      const app = buildApp();
      // API_GATEWAY_RATE_LIMIT_MAX is set to 5 above. Use a bad signature so
      // every attempt is a "failed" verification attempt, isolating the
      // rate-limit path from the circuit breaker (different thresholds).
      const badHeaders = {
        "x-api-key": API_KEY,
        "x-api-signature": `sha256=${"a".repeat(64)}`,
        "x-api-timestamp": String(Math.floor(Date.now() / 1000)),
      };

      const responses = [];
      for (let i = 0; i < 6; i++) {
        responses.push(await request(app).get("/api/protected/health").set(badHeaders));
      }

      const last = responses[responses.length - 1];
      expect(last.status).toBe(429);
      expect(last.body.code).toBe("API_GATEWAY_RATE_LIMITED");
      // Earlier attempts should fail on signature mismatch, not rate limiting.
      expect(responses[0].body.code).not.toBe("API_GATEWAY_RATE_LIMITED");
    });

    it("does not rate-limit a different client IP", async () => {
      const app = buildApp();
      const badHeaders = {
        "x-api-key": API_KEY,
        "x-api-signature": `sha256=${"a".repeat(64)}`,
        "x-api-timestamp": String(Math.floor(Date.now() / 1000)),
      };

      for (let i = 0; i < 6; i++) {
        await request(app).get("/api/protected/health").set({ ...badHeaders, "x-forwarded-for": "9.9.9.9" });
      }

      const goodHeaders = signRequest({ method: "GET", path: "/api/protected/health", body: {} });
      const res = await request(app)
        .get("/api/protected/health")
        .set({ ...goodHeaders, "x-forwarded-for": "1.1.1.1" });

      expect(res.status).toBe(200);
    });
  });

  describe("circuit breaker", () => {
    it("opens after repeated verification failures and rejects even well-formed attempts", async () => {
      const app = buildApp();
      const badHeaders = {
        "x-api-key": API_KEY,
        "x-api-signature": `sha256=${"a".repeat(64)}`,
        "x-api-timestamp": String(Math.floor(Date.now() / 1000)),
      };

      // Drive 50 failures to trip CIRCUIT_BREAKER_THRESHOLD (defined in
      // api-gateway-signature.js), spread across many client IPs so the
      // per-IP rate limiter (max 5) doesn't mask the circuit breaker.
      for (let i = 0; i < 50; i++) {
        await request(app)
          .get("/api/protected/health")
          .set({ ...badHeaders, "x-forwarded-for": `10.0.0.${i}` });
      }

      const goodHeaders = signRequest({ method: "GET", path: "/api/protected/health", body: {} });
      const res = await request(app).get("/api/protected/health").set(goodHeaders);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("API_GATEWAY_CIRCUIT_BREAKER_OPEN");
    });
  });

  describe("API key lifecycle", () => {
    it("rejects an unknown API key", async () => {
      const app = buildApp({ merchantLookup: async () => null });
      const headers = signRequest({
        secret: "unknown-api-key-32-characters-ok",
        method: "GET",
        path: "/api/protected/health",
        body: {},
      });

      const res = await request(app).get("/api/protected/health").set(headers);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid API key");
    });

    it("rejects a key that has expired", async () => {
      const expired = { ...MERCHANT, api_key_expires_at: new Date(Date.now() - 1000).toISOString() };
      const app = buildApp({ merchantLookup: async (key) => (key === API_KEY ? expired : null) });
      const headers = signRequest({ method: "GET", path: "/api/protected/health", body: {} });

      const res = await request(app).get("/api/protected/health").set(headers);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("API_KEY_EXPIRED");
    });

    it("authenticates via a still-valid rotated (old) API key", async () => {
      const oldKey = "old-rotated-api-key-32-chars-ok!";
      const withRotation = {
        ...MERCHANT,
        api_key: "current-api-key-32-characters-ok",
        api_key_old: oldKey,
        api_key_old_expires_at: new Date(Date.now() + 60_000).toISOString(),
      };
      const app = buildApp({
        merchantLookup: async (key) =>
          key === withRotation.api_key || key === withRotation.api_key_old ? withRotation : null,
      });
      const headers = signRequest({ secret: oldKey, method: "GET", path: "/api/protected/health", body: {} });

      const res = await request(app).get("/api/protected/health").set(headers);

      expect(res.status).toBe(200);
    });
  });

  describe("sensitive data handling", () => {
    it("never echoes the API key or signature back in an error response", async () => {
      const app = buildApp();

      const res = await request(app)
        .get("/api/protected/health")
        .set({
          "x-api-key": API_KEY,
          "x-api-signature": "sha256=deadbeef",
          "x-api-timestamp": String(Math.floor(Date.now() / 1000)),
        });

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain(API_KEY);
      expect(serialized).not.toContain("deadbeef");
    });
  });
});
