/**
 * Tests for Transaction Signer Rate Limiting
 * Issue: Rate Limiting Protections for Transaction Signer
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockRedisClient = vi.hoisted(() => ({
  sendCommand: vi.fn(),
}));

vi.mock("rate-limit-redis", () => ({
  RedisStore: vi.fn().mockImplementation(() => ({
    sendCommand: mockRedisClient.sendCommand,
  })),
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./metrics.js", () => ({
  rateLimitExceededTotal: { inc: vi.fn() },
  rateLimitRequestsTotal: { inc: vi.fn() },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  getTransactionSignerRateLimitKey,
  getTransactionSignerBurstRateLimitKey,
  createTransactionSignerRateLimit,
  createTransactionSignerBurstRateLimit,
  recordTransactionSignerRequestMetrics,
  isValidWebhookUrl,
} from "./transaction-signer-rate-limit.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Transaction Signer Rate Limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rate Limit Key Generation ─────────────────────────────────────────────────

  describe("getTransactionSignerRateLimitKey", () => {
    it("generates key with merchant_id when available", () => {
      const req = {
        params: { txHash: "abc123" },
        merchant: { id: "merchant-001" },
        ip: "192.168.1.1",
      };

      const key = getTransactionSignerRateLimitKey(req);
      expect(key).toBe("abc123:merchant:merchant-001");
    });

    it("generates key with API key hash when merchant_id not available", () => {
      const req = {
        params: { txHash: "abc123" },
        headers: { "x-api-key": "secret-key-123" },
        ip: "192.168.1.1",
      };

      const key = getTransactionSignerRateLimitKey(req);
      expect(key).toMatch(/^abc123:api:[a-f0-9]{64}$/);
    });

    it("generates key with IP when neither merchant_id nor API key available", () => {
      const req = {
        params: { txHash: "abc123" },
        ip: "192.168.1.1",
      };

      const key = getTransactionSignerRateLimitKey(req);
      expect(key).toBe("abc123:ip:192.168.1.1");
    });

    it("uses body.txHash when params.txHash not available", () => {
      const req = {
        body: { txHash: "xyz789" },
        ip: "192.168.1.1",
      };

      const key = getTransactionSignerRateLimitKey(req);
      expect(key).toBe("xyz789:ip:192.168.1.1");
    });

    it("uses unknown-tx when no txHash available", () => {
      const req = {
        ip: "192.168.1.1",
      };

      const key = getTransactionSignerRateLimitKey(req);
      expect(key).toBe("unknown-tx:ip:192.168.1.1");
    });
  });

  // ── Burst Rate Limit Key Generation ───────────────────────────────────────────

  describe("getTransactionSignerBurstRateLimitKey", () => {
    it("generates burst key with merchant_id when available", () => {
      const req = {
        merchant: { id: "merchant-001" },
        ip: "192.168.1.1",
      };

      const key = getTransactionSignerBurstRateLimitKey(req);
      expect(key).toBe("burst:merchant:merchant-001");
    });

    it("generates burst key with API key hash when merchant_id not available", () => {
      const req = {
        headers: { "x-api-key": "secret-key-123" },
        ip: "192.168.1.1",
      };

      const key = getTransactionSignerBurstRateLimitKey(req);
      expect(key).toMatch(/^burst:api:[a-f0-9]{64}$/);
    });

    it("generates burst key with IP when neither merchant_id nor API key available", () => {
      const req = {
        ip: "192.168.1.1",
      };

      const key = getTransactionSignerBurstRateLimitKey(req);
      expect(key).toBe("burst:ip:192.168.1.1");
    });
  });

  // ── Rate Limiter Creation ─────────────────────────────────────────────────────

  describe("createTransactionSignerRateLimit", () => {
    it("creates rate limiter with default configuration", () => {
      const limiter = createTransactionSignerRateLimit({});

      expect(limiter).toBeDefined();
      expect(limiter.windowMs).toBe(60_000); // 1 minute
      expect(limiter.max).toBe(100); // 100 requests
    });

    it("creates rate limiter with custom configuration", () => {
      const limiter = createTransactionSignerRateLimit({
        windowMs: 30_000,
        max: 50,
      });

      expect(limiter).toBeDefined();
      expect(limiter.windowMs).toBe(30_000);
      expect(limiter.max).toBe(50);
    });

    it("uses custom store when provided", () => {
      const mockStore = {};
      const limiter = createTransactionSignerRateLimit({ store: mockStore });

      expect(limiter).toBeDefined();
    });
  });

  // ── Burst Rate Limiter Creation ─────────────────────────────────────────────

  describe("createTransactionSignerBurstRateLimit", () => {
    it("creates burst rate limiter with default configuration", () => {
      const limiter = createTransactionSignerBurstRateLimit({});

      expect(limiter).toBeDefined();
      expect(limiter.windowMs).toBe(10_000); // 10 seconds
      expect(limiter.max).toBe(20); // 20 requests
    });

    it("creates burst rate limiter with custom configuration", () => {
      const limiter = createTransactionSignerBurstRateLimit({
        windowMs: 5_000,
        max: 10,
      });

      expect(limiter).toBeDefined();
      expect(limiter.windowMs).toBe(5_000);
      expect(limiter.max).toBe(10);
    });
  });

  // ── Request Metrics Recording ────────────────────────────────────────────────

  describe("recordTransactionSignerRequestMetrics", () => {
    it("records metrics for merchant requests", async () => {
      const req = {
        merchant: { id: "merchant-001" },
        ip: "192.168.1.1",
      };
      const res = {};
      const next = vi.fn();

      await recordTransactionSignerRequestMetrics(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("records metrics for API key requests", async () => {
      const req = {
        headers: { "x-api-key": "secret-key-123" },
        ip: "192.168.1.1",
      };
      const res = {};
      const next = vi.fn();

      await recordTransactionSignerRequestMetrics(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("records metrics for IP-based requests", async () => {
      const req = {
        ip: "192.168.1.1",
      };
      const res = {};
      const next = vi.fn();

      await recordTransactionSignerRequestMetrics(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ── Webhook URL Validation ───────────────────────────────────────────────────

  describe("isValidWebhookUrl", () => {
    it("returns true for valid HTTPS webhook URL", () => {
      const url = "https://example.com/webhook";
      expect(isValidWebhookUrl(url)).toBe(true);
    });

    it("returns false for HTTP webhook URL", () => {
      const url = "http://example.com/webhook";
      expect(isValidWebhookUrl(url)).toBe(false);
    });

    it("returns false for localhost URL", () => {
      const url = "https://localhost/webhook";
      expect(isValidWebhookUrl(url)).toBe(false);
    });

    it("returns false for 127.0.0.1 URL", () => {
      const url = "https://127.0.0.1/webhook";
      expect(isValidWebhookUrl(url)).toBe(false);
    });

    it("returns false for 10.x.x.x internal network URL", () => {
      const url = "https://10.0.0.1/webhook";
      expect(isValidWebhookUrl(url)).toBe(false);
    });

    it("returns false for 192.168.x.x internal network URL", () => {
      const url = "https://192.168.1.1/webhook";
      expect(isValidWebhookUrl(url)).toBe(false);
    });

    it("returns false for 172.16.x.x internal network URL", () => {
      const url = "https://172.16.0.1/webhook";
      expect(isValidWebhookUrl(url)).toBe(false);
    });

    it("returns false for invalid URL format", () => {
      const url = "not-a-valid-url";
      expect(isValidWebhookUrl(url)).toBe(false);
    });

    it("returns false for null or undefined URL", () => {
      expect(isValidWebhookUrl(null)).toBe(false);
      expect(isValidWebhookUrl(undefined)).toBe(false);
    });

    it("returns false for empty string URL", () => {
      expect(isValidWebhookUrl("")).toBe(false);
    });

    it("returns true for valid external HTTPS URL", () => {
      const url = "https://api.example.com/webhook";
      expect(isValidWebhookUrl(url)).toBe(true);
    });
  });
});
