import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  signApiGatewayRequest,
  verifyApiGatewayRequestSignature,
  verifyApiGatewayRequestSignatureWithRotation,
  _resetApiGatewayRateLimitStateForTests,
  _apiGatewayRateLimitState,
  _verifiedSignatureCache,
  getApiGatewaySignatureCacheStats,
  reserveApiGatewaySignature,
} from "./api-gateway-signature.js";

// All secrets must be >= 16 characters (MIN_SECRET_LENGTH enforcement, issue #767)
const VALID_SECRET = "test-api-key-secure-32chars-padded";

// Mock logger
vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("api-gateway-signature", () => {
  beforeEach(() => {
    _resetApiGatewayRateLimitStateForTests();
  });
  it("signs and verifies request payloads", () => {
    const timestamp = 1713916800;

    const signature = signApiGatewayRequest({
      secret: VALID_SECRET,
      method: "POST",
      path: "/api/payments",
      timestamp,
      body: { amount: 12.5, asset: "USDC" },
    });

    const result = verifyApiGatewayRequestSignature({
      secret: VALID_SECRET,
      method: "POST",
      path: "/api/payments",
      timestampHeader: String(timestamp),
      signatureHeader: `sha256=${signature}`,
      body: { amount: 12.5, asset: "USDC" },
      now: timestamp * 1000,
    });

    expect(result).toEqual({ valid: true });
  });

  it("rejects signatures outside timestamp tolerance", () => {
    const timestamp = 1713916800;

    const signature = signApiGatewayRequest({
      secret: VALID_SECRET,
      method: "GET",
      path: "/api/metrics/summary",
      timestamp,
      body: {},
    });

    const result = verifyApiGatewayRequestSignature({
      secret: VALID_SECRET,
      method: "GET",
      path: "/api/metrics/summary",
      timestampHeader: String(timestamp),
      signatureHeader: `sha256=${signature}`,
      body: {},
      now: (timestamp + 900) * 1000,
      toleranceSeconds: 300,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/outside the accepted window/i);
  });

  it("rejects malformed signature headers", () => {
    const result = verifyApiGatewayRequestSignature({
      secret: VALID_SECRET,
      method: "GET",
      path: "/health",
      timestampHeader: "1713916800",
      signatureHeader: "not-a-signature",
      body: {},
      now: 1713916800 * 1000,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/invalid x-api-signature/i);
  });

  it.each(["1713916800abc", "1713916800.5", "+1713916800", "0x6611f800"])(
    "rejects non-canonical timestamp %s",
    (timestampHeader) => {
      const result = verifyApiGatewayRequestSignature({
        secret: VALID_SECRET,
        method: "GET",
        path: "/health",
        timestampHeader,
        signatureHeader: "sha256=" + "a".repeat(64),
        body: {},
        now: 1713916800 * 1000,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/invalid x-api-timestamp/i);
    },
  );

  describe("distributed replay reservation", () => {
    it("atomically reserves a mutating signature with Redis SET NX", async () => {
      const set = vi.fn().mockResolvedValue("OK");
      const redisClient = { isOpen: true, set };

      const result = await reserveApiGatewaySignature({
        secret: VALID_SECRET,
        signatureHeader: "sha256=" + "a".repeat(64),
        method: "POST",
        toleranceSeconds: 300,
        redisClient,
      });

      expect(result).toEqual({ reserved: true });
      expect(set).toHaveBeenCalledWith(
        expect.stringMatching(/^api-gateway:replay:[a-f0-9]{64}$/),
        "1",
        { NX: true, EX: 300 },
      );
    });

    it("rejects a signature when Redis reports that it is already reserved", async () => {
      const redisClient = { isOpen: true, set: vi.fn().mockResolvedValue(null) };

      const result = await reserveApiGatewaySignature({
        secret: VALID_SECRET,
        signatureHeader: "sha256=" + "b".repeat(64),
        method: "POST",
        toleranceSeconds: 300,
        redisClient,
      });

      expect(result).toEqual({ reserved: false, replay: true });
    });

    it("fails closed when configured Redis is unavailable", async () => {
      const redisClient = { isOpen: false, set: vi.fn() };

      const result = await reserveApiGatewaySignature({
        secret: VALID_SECRET,
        signatureHeader: "sha256=" + "c".repeat(64),
        method: "POST",
        toleranceSeconds: 300,
        redisClient,
      });

      expect(result.reserved).toBe(false);
      expect(result.code).toBe("API_GATEWAY_REPLAY_PROTECTION_UNAVAILABLE");
      expect(redisClient.set).not.toHaveBeenCalled();
    });
  });

  // ── Security audit: minimum secret length (#767) ──────────────────────────

  it("rejects signing with a secret shorter than the minimum length", () => {
    const result = signApiGatewayRequest({
      secret: "short",
      method: "GET",
      path: "/health",
      timestamp: 1713916800,
      body: {},
    });

    expect(result).toBeNull();
  });

  it("rejects verification with a secret shorter than the minimum length", () => {
    const result = verifyApiGatewayRequestSignature({
      secret: "tooshort",
      method: "GET",
      path: "/health",
      timestampHeader: "1713916800",
      signatureHeader: "sha256=" + "a".repeat(64),
      body: {},
      now: 1713916800 * 1000,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/insufficient.*secret/i);
  });

  it("rejects verification with a missing secret", () => {
    const result = verifyApiGatewayRequestSignature({
      secret: "",
      method: "GET",
      path: "/health",
      timestampHeader: "1713916800",
      signatureHeader: "sha256=" + "a".repeat(64),
      body: {},
      now: 1713916800 * 1000,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/insufficient.*secret/i);
  });

  it("detects a tampered body by producing a different signature", () => {
    const timestamp = 1713916800;

    const signature = signApiGatewayRequest({
      secret: VALID_SECRET,
      method: "POST",
      path: "/api/payments",
      timestamp,
      body: { amount: 10 },
    });

    const result = verifyApiGatewayRequestSignature({
      secret: VALID_SECRET,
      method: "POST",
      path: "/api/payments",
      timestampHeader: String(timestamp),
      signatureHeader: `sha256=${signature}`,
      body: { amount: 99 }, // tampered
      now: timestamp * 1000,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/verification failed/i);
  });

  // ── Security audit #901: Stale entry cleanup ───────────────────────────────

  it("cleans up stale rate limit entries when threshold exceeded", () => {
    vi.useFakeTimers();

    const staleStart = Date.now() - 300000; // 5 minutes ago
    for (let i = 0; i < 10001; i++) {
      const key = `api-gateway:192.168.1.${i}`;
      // Manually set stale entries
      _apiGatewayRateLimitState.set(key, {
        count: 1,
        windowStart: staleStart,
        failures: 0,
      });
    }

    // Trigger cleanup by recording a new attempt
    verifyApiGatewayRequestSignature({
      secret: VALID_SECRET,
      method: "GET",
      path: "/health",
      timestampHeader: "1713916800",
      signatureHeader: "sha256=" + "a".repeat(64),
      body: {},
      now: Date.now(),
    });

    expect(_apiGatewayRateLimitState.size).toBeLessThan(10001);

    vi.useRealTimers();
  });

  // ── Error recovery #900: Circuit breaker pattern ───────────────────────────

  it("opens circuit breaker after repeated failures", () => {
    const timestamp = 1713916800;
    const invalidSignature = "sha256=" + "a".repeat(64);

    // Trigger 50 failures to open circuit breaker
    for (let i = 0; i < 50; i++) {
      verifyApiGatewayRequestSignature({
        secret: VALID_SECRET,
        method: "GET",
        path: "/health",
        timestampHeader: String(timestamp),
        signatureHeader: invalidSignature,
        body: {},
        now: timestamp * 1000,
      });
    }

    // Circuit breaker should now be open
    const result = verifyApiGatewayRequestSignature({
      secret: VALID_SECRET,
      method: "GET",
      path: "/health",
      timestampHeader: String(timestamp),
      signatureHeader: invalidSignature,
      body: {},
      now: timestamp * 1000,
    });

    expect(result.valid).toBe(false);
    expect(result.code).toBe("API_GATEWAY_CIRCUIT_BREAKER_OPEN");
  });

  it("resets circuit breaker after cooldown period", () => {
    vi.useFakeTimers();

    const timestamp = 1713916800;
    const invalidSignature = "sha256=" + "a".repeat(64);

    // Open circuit breaker
    for (let i = 0; i < 50; i++) {
      verifyApiGatewayRequestSignature({
        secret: VALID_SECRET,
        method: "GET",
        path: "/health",
        timestampHeader: String(timestamp),
        signatureHeader: invalidSignature,
        body: {},
        now: timestamp * 1000,
      });
    }

    // Advance past cooldown period (60s)
    vi.advanceTimersByTime(61000);

    // Circuit breaker should be reset
    const result = verifyApiGatewayRequestSignature({
      secret: VALID_SECRET,
      method: "GET",
      path: "/health",
      timestampHeader: String(timestamp),
      signatureHeader: invalidSignature,
      body: {},
      now: timestamp * 1000 + 61000,
    });

    expect(result.code).not.toBe("API_GATEWAY_CIRCUIT_BREAKER_OPEN");

    vi.useRealTimers();
  });

  it("decrements circuit breaker failure count on success", () => {
    const timestamp = 1713916800;

    // Create a valid signature
    const validSignature = signApiGatewayRequest({
      secret: VALID_SECRET,
      method: "GET",
      path: "/health",
      timestamp,
      body: {},
    });

    // Trigger some failures
    for (let i = 0; i < 10; i++) {
      verifyApiGatewayRequestSignature({
        secret: VALID_SECRET,
        method: "GET",
        path: "/health",
        timestampHeader: String(timestamp),
        signatureHeader: "sha256=" + "a".repeat(64),
        body: {},
        now: timestamp * 1000,
      });
    }

    // Success should decrement failure count
    verifyApiGatewayRequestSignature({
      secret: VALID_SECRET,
      method: "GET",
      path: "/health",
      timestampHeader: String(timestamp),
      signatureHeader: `sha256=${validSignature}`,
      body: {},
      now: timestamp * 1000,
    });

    // Circuit breaker should not be open
    const result = verifyApiGatewayRequestSignature({
      secret: VALID_SECRET,
      method: "GET",
      path: "/health",
      timestampHeader: String(timestamp),
      signatureHeader: "sha256=" + "a".repeat(64),
      body: {},
      now: timestamp * 1000,
    });

    expect(result.code).not.toBe("API_GATEWAY_CIRCUIT_BREAKER_OPEN");
  });

  // ── Error recovery #900: Graceful error handling ───────────────────────────

  it("handles unexpected errors gracefully", () => {
    const result = verifyApiGatewayRequestSignature({
      secret: VALID_SECRET,
      method: "GET",
      path: "/health",
      timestampHeader: "invalid-timestamp",
      signatureHeader: "sha256=" + "a".repeat(64),
      body: {},
      now: 1713916800 * 1000,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("timestamp");
  });

  // ── Caching mechanism #1060: replay-protection cache ─────────────────────

  describe("replay-protection cache", () => {
    it("rejects a second use of an already-verified signature", () => {
      const timestamp = 1713916800;
      const signature = signApiGatewayRequest({
        secret: VALID_SECRET,
        method: "POST",
        path: "/api/payments",
        timestamp,
        body: {},
      });
      const params = {
        secret: VALID_SECRET,
        method: "POST",
        path: "/api/payments",
        timestampHeader: String(timestamp),
        signatureHeader: `sha256=${signature}`,
        body: {},
        now: timestamp * 1000,
      };

      const first = verifyApiGatewayRequestSignature(params);
      const replay = verifyApiGatewayRequestSignature(params);

      expect(first).toEqual({ valid: true });
      expect(replay.valid).toBe(false);
      expect(replay.code).toBe("API_GATEWAY_REPLAY_DETECTED");
    });

    it("does not apply replay protection to read-only GET requests", () => {
      // GET/HEAD are excluded from replay protection: the signature has
      // only 1-second timestamp granularity, so two genuinely distinct GET
      // requests (e.g. a client polling an unchanged query) can legitimately
      // produce an identical signature. Blocking the second would break
      // real polling clients for no security benefit, since re-executing a
      // read has no side effect.
      const timestamp = 1713916800;
      const signature = signApiGatewayRequest({
        secret: VALID_SECRET,
        method: "GET",
        path: "/api/metrics/summary",
        timestamp,
        body: {},
      });
      const params = {
        secret: VALID_SECRET,
        method: "GET",
        path: "/api/metrics/summary",
        timestampHeader: String(timestamp),
        signatureHeader: `sha256=${signature}`,
        body: {},
        now: timestamp * 1000,
      };

      const first = verifyApiGatewayRequestSignature(params);
      const second = verifyApiGatewayRequestSignature(params);

      expect(first).toEqual({ valid: true });
      expect(second).toEqual({ valid: true });
    });

    it("allows two different requests signed within the same second", () => {
      const timestamp = 1713916800;
      const paramsFor = (path) => {
        const signature = signApiGatewayRequest({
          secret: VALID_SECRET,
          method: "POST",
          path,
          timestamp,
          body: {},
        });
        return {
          secret: VALID_SECRET,
          method: "POST",
          path,
          timestampHeader: String(timestamp),
          signatureHeader: `sha256=${signature}`,
          body: {},
          now: timestamp * 1000,
        };
      };

      const resultA = verifyApiGatewayRequestSignature(paramsFor("/api/payments"));
      const resultB = verifyApiGatewayRequestSignature(paramsFor("/api/refunds"));

      expect(resultA).toEqual({ valid: true });
      expect(resultB).toEqual({ valid: true });
    });

    it("allows the same signature again once its tolerance window has fully elapsed", () => {
      const timestamp = 1713916800;
      const signature = signApiGatewayRequest({
        secret: VALID_SECRET,
        method: "POST",
        path: "/api/payments",
        timestamp,
        body: {},
      });

      const first = verifyApiGatewayRequestSignature({
        secret: VALID_SECRET,
        method: "POST",
        path: "/api/payments",
        timestampHeader: String(timestamp),
        signatureHeader: `sha256=${signature}`,
        body: {},
        now: timestamp * 1000,
        toleranceSeconds: 300,
      });

      // The cache entry expires 300s after it was recorded. By then the
      // timestamp itself would also fail the freshness check on a genuine
      // resend, so this only matters for the internal bookkeeping (it must
      // not leak memory by holding entries forever).
      expect(_verifiedSignatureCache.has(signature)).toBe(true);

      // Manually expire it the way the cache's own TTL would.
      _verifiedSignatureCache.set(signature, timestamp * 1000 - 1);
      const stale = verifyApiGatewayRequestSignature({
        secret: VALID_SECRET,
        method: "POST",
        path: "/api/payments",
        timestampHeader: String(timestamp),
        signatureHeader: `sha256=${signature}`,
        body: {},
        now: timestamp * 1000,
        toleranceSeconds: 300,
      });

      expect(first).toEqual({ valid: true });
      expect(stale).toEqual({ valid: true });
    });

    it("does not cache invalid signatures", () => {
      verifyApiGatewayRequestSignature({
        secret: VALID_SECRET,
        method: "POST",
        path: "/health",
        timestampHeader: "1713916800",
        signatureHeader: "sha256=" + "a".repeat(64),
        body: {},
        now: 1713916800 * 1000,
      });

      expect(getApiGatewaySignatureCacheStats().size).toBe(0);
    });

    it("also blocks replays when verifying with key rotation", () => {
      const timestamp = 1713916800;
      const signature = signApiGatewayRequest({
        secret: VALID_SECRET,
        method: "POST",
        path: "/api/payments",
        timestamp,
        body: {},
      });
      const params = {
        secrets: [VALID_SECRET, "previous-secret-also-32-chars-ok"],
        method: "POST",
        path: "/api/payments",
        timestampHeader: String(timestamp),
        signatureHeader: `sha256=${signature}`,
        body: {},
        now: timestamp * 1000,
      };

      const first = verifyApiGatewayRequestSignatureWithRotation(params);
      const replay = verifyApiGatewayRequestSignatureWithRotation(params);

      expect(first.valid).toBe(true);
      expect(replay.valid).toBe(false);
    });
  });
});
