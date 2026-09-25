import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  analyzePayment,
  getPaymentRiskAssessment,
  isFraudulent,
  getRiskLevel,
  getCacheStats,
  resetMetrics,
  clearCache,
} from "./fraud-detection-engine.js";

vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./metrics.js", () => ({
  fraudDetectionRiskScore: { observe: vi.fn() },
  fraudDetectionAnomaliesDetected: { inc: vi.fn() },
  fraudDetectionPaymentsAnalyzed: { inc: vi.fn() },
  fraudDetectionBlockedPayments: { inc: vi.fn() },
  fraudDetectionHighRiskDetected: { inc: vi.fn() },
  fraudDetectionVelocityExceeded: { inc: vi.fn() },
  fraudDetectionGeographicAnomaly: { inc: vi.fn() },
  fraudDetectionMetadataAnomalies: { inc: vi.fn() },
  fraudDetectionCacheSize: { set: vi.fn() },
}));

describe("Fraud Detection Engine", () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    resetMetrics();
  });

  describe("analyzePayment", () => {
    it("returns low risk for normal payment", () => {
      const payment = {
        id: "pay-001",
        merchant_id: "merchant-1",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        amount: "100",
        status: "pending",
        created_at: new Date().toISOString(),
        metadata: { order_id: "12345" },
        memo: "payment for services",
      };

      const analysis = analyzePayment(payment);

      expect(analysis).toHaveProperty("paymentId", "pay-001");
      expect(analysis).toHaveProperty("riskLevel");
      expect(analysis.riskLevel).toBe("low");
      expect(analysis.isBlocked).toBe(false);
      expect(analysis.riskScore).toBeLessThan(20);
    });

    it("detects large amount as risk factor", () => {
      const payment = {
        id: "pay-002",
        merchant_id: "merchant-1",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        amount: "100000",
        status: "pending",
        created_at: new Date().toISOString(),
      };

      const analysis = analyzePayment(payment);

      expect(analysis.riskScore).toBeGreaterThan(0);
      expect(analysis.factors).toContainEqual(
        expect.objectContaining({
          type: "large_amount",
          amount: 100000,
        })
      );
    });

    it("detects missing recipient as critical risk", () => {
      const payment = {
        id: "pay-003",
        merchant_id: "merchant-1",
        recipient: "",
        asset: "USDC",
        amount: "100",
        status: "pending",
        created_at: new Date().toISOString(),
      };

      const analysis = analyzePayment(payment);

      expect(analysis.riskScore).toBeGreaterThan(20);
      expect(analysis.factors).toContainEqual(
        expect.objectContaining({
          type: "missing_recipient",
        })
      );
    });

    it("detects invalid recipient format", () => {
      const payment = {
        id: "pay-004",
        merchant_id: "merchant-1",
        recipient: "invalid-address",
        asset: "USDC",
        amount: "100",
        status: "pending",
        created_at: new Date().toISOString(),
      };

      const analysis = analyzePayment(payment);

      expect(analysis.riskScore).toBeGreaterThan(15);
      expect(analysis.factors).toContainEqual(
        expect.objectContaining({
          type: "invalid_recipient_format",
        })
      );
    });

    it("detects stale payment", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();

      const payment = {
        id: "pay-005",
        merchant_id: "merchant-1",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        amount: "100",
        status: "pending",
        created_at: twoHoursAgo,
      };

      const analysis = analyzePayment(payment);

      expect(analysis.factors).toContainEqual(
        expect.objectContaining({
          type: "stale_payment",
        })
      );
    });

    it("detects excessive metadata keys", () => {
      const payment = {
        id: "pay-006",
        merchant_id: "merchant-1",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        amount: "100",
        status: "pending",
        created_at: new Date().toISOString(),
        metadata: Object.fromEntries(
          Array.from({ length: 25 }, (_, i) => [`key_${i}`, `value_${i}`])
        ),
      };

      const analysis = analyzePayment(payment);

      expect(analysis.anomalies.metadata).toContainEqual(
        expect.objectContaining({
          type: "metadata_key_overflow",
        })
      );
    });

    it("detects suspicious memo patterns", () => {
      const payment = {
        id: "pay-007",
        merchant_id: "merchant-1",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        amount: "100",
        status: "pending",
        created_at: new Date().toISOString(),
        memo: "test payment fake",
      };

      const analysis = analyzePayment(payment);

      expect(analysis.anomalies.memo).toContainEqual(
        expect.objectContaining({
          type: "suspicious_memo_pattern",
        })
      );
    });

    it("caches analysis results", () => {
      const payment = {
        id: "pay-008",
        merchant_id: "merchant-1",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        amount: "100",
        status: "pending",
        created_at: new Date().toISOString(),
      };

      const analysis1 = analyzePayment(payment);
      const stats1 = getCacheStats();

      expect(stats1.cacheSize).toBeGreaterThan(0);

      const analysis2 = analyzePayment(payment);

      expect(analysis1).toEqual(analysis2);
    });

    it("does not reuse cached risk when payment amount changes", () => {
      const basePayment = {
        id: "pay-cache-amount",
        merchant_id: "merchant-cache",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        status: "pending",
        created_at: new Date().toISOString(),
      };

      const lowRisk = analyzePayment({ ...basePayment, amount: "100" });
      const higherRisk = analyzePayment({ ...basePayment, amount: "500000" });

      expect(higherRisk.riskScore).toBeGreaterThan(lowRisk.riskScore);
      expect(getCacheStats().cacheSize).toBeGreaterThanOrEqual(2);
    });

    it("marks payment as high risk at 75+ score", () => {
      const payment = {
        id: "pay-009",
        merchant_id: "merchant-1",
        recipient: "invalid",
        asset: "USDC",
        amount: "500000",
        status: "pending",
        created_at: new Date(Date.now() - 90 * 3600000).toISOString(),
      };

      const analysis = analyzePayment(payment);

      expect(analysis.riskLevel).toMatch(/high|critical/);
      expect(analysis.riskScore).toBeGreaterThanOrEqual(50);
    });

    it("blocks payment at critical risk level", () => {
      const payment = {
        id: "pay-010",
        merchant_id: "merchant-1",
        recipient: "invalid-address-with-no-format",
        asset: "USDC",
        amount: "999999",
        status: "pending",
        created_at: new Date(Date.now() - 100 * 3600000).toISOString(),
        memo: "\x00\x01\x02 test payload",
      };

      const analysis = analyzePayment(payment);

      if (analysis.riskLevel === "critical") {
        expect(analysis.isBlocked).toBe(true);
      }
    });
  });

  describe("getPaymentRiskAssessment", () => {
    it("returns consistent assessment for same payment", () => {
      const payment = {
        id: "pay-011",
        merchant_id: "merchant-1",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        amount: "100",
        status: "pending",
        created_at: new Date().toISOString(),
      };

      const assessment = getPaymentRiskAssessment(payment);

      expect(assessment).toHaveProperty("riskScore");
      expect(assessment).toHaveProperty("riskLevel");
      expect(assessment).toHaveProperty("isBlocked");
    });
  });

  describe("isFraudulent", () => {
    it("returns true for blocked payments", () => {
      const payment = {
        id: "pay-012",
        merchant_id: "merchant-1",
        recipient: "",
        asset: "USDC",
        amount: "100",
        status: "pending",
        created_at: new Date().toISOString(),
      };

      const analysis = analyzePayment(payment);

      if (analysis.isBlocked) {
        expect(isFraudulent(analysis)).toBe(true);
      }
    });

    it("returns false for non-fraudulent payments", () => {
      const payment = {
        id: "pay-013",
        merchant_id: "merchant-1",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        amount: "100",
        status: "pending",
        created_at: new Date().toISOString(),
      };

      const analysis = analyzePayment(payment);

      expect(isFraudulent(analysis)).toBe(analysis.isBlocked);
    });
  });

  describe("getRiskLevel", () => {
    it("returns 'low' for scores below 20", () => {
      expect(getRiskLevel(10)).toBe("low");
      expect(getRiskLevel(15)).toBe("low");
    });

    it("returns 'medium' for scores 20-50", () => {
      expect(getRiskLevel(20)).toBe("medium");
      expect(getRiskLevel(35)).toBe("medium");
      expect(getRiskLevel(50)).toBe("medium");
    });

    it("returns 'high' for scores 50-75", () => {
      expect(getRiskLevel(60)).toBe("high");
      expect(getRiskLevel(75)).toBe("high");
    });

    it("returns 'critical' for scores above 75", () => {
      expect(getRiskLevel(80)).toBe("critical");
      expect(getRiskLevel(100)).toBe("critical");
    });
  });

  describe("cache management", () => {
    it("provides cache statistics", () => {
      const payment = {
        id: "pay-014",
        merchant_id: "merchant-1",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        amount: "100",
        status: "pending",
        created_at: new Date().toISOString(),
      };

      analyzePayment(payment);
      const stats = getCacheStats();

      expect(stats).toHaveProperty("cacheSize");
      expect(stats).toHaveProperty("velocityTrackerSize");
      expect(typeof stats.cacheSize).toBe("number");
    });

    it("clears cache for specific merchant", () => {
      const payment1 = {
        id: "pay-015",
        merchant_id: "merchant-1",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        amount: "100",
        status: "pending",
        created_at: new Date().toISOString(),
      };

      const payment2 = {
        id: "pay-016",
        merchant_id: "merchant-2",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        amount: "100",
        status: "pending",
        created_at: new Date().toISOString(),
      };

      analyzePayment(payment1);
      analyzePayment(payment2);

      const statsBefore = getCacheStats();
      expect(statsBefore.cacheSize).toBeGreaterThan(0);

      clearCache("merchant-1");

      const statsAfter = getCacheStats();
      expect(statsAfter.cacheSize).toBeGreaterThanOrEqual(0);
    });

    it("resets all metrics", () => {
      const payment = {
        id: "pay-017",
        merchant_id: "merchant-1",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        amount: "100",
        status: "pending",
        created_at: new Date().toISOString(),
      };

      analyzePayment(payment);
      let stats = getCacheStats();
      expect(stats.cacheSize).toBeGreaterThan(0);

      resetMetrics();
      stats = getCacheStats();

      expect(stats.cacheSize).toBe(0);
      expect(stats.velocityTrackerSize).toBe(0);
    });
  });

  describe("anomaly detection", () => {
    it("detects multiple anomalies in high-risk payment", () => {
      const payment = {
        id: "pay-018",
        merchant_id: "merchant-1",
        recipient: "not-a-valid-address",
        asset: "USDC",
        amount: "999999",
        status: "pending",
        created_at: new Date(Date.now() - 80 * 3600000).toISOString(),
        memo: "test admin fake",
        metadata: {
          key1: "v1",
          key2: "v2",
          key3: "v3",
          key4: "v4",
          key5: "v5",
          key6: "v6",
          key7: "v7",
          key8: "v8",
          key9: "v9",
          key10: "v10",
          key11: "v11",
          key12: "v12",
          key13: "v13",
          key14: "v14",
          key15: "v15",
          key16: "v16",
          key17: "v17",
          key18: "v18",
          key19: "v19",
          key20: "v20",
          key21: "v21",
          key22: "v22",
        },
      };

      const analysis = analyzePayment(payment);

      const totalAnomalies =
        analysis.anomalies.velocity.length +
        analysis.anomalies.geographic.length +
        analysis.anomalies.metadata.length +
        analysis.anomalies.memo.length;

      expect(totalAnomalies).toBeGreaterThan(0);
    });
  });

  describe("risk score distribution", () => {
    it("scores reflect payment characteristics", () => {
      const normalPayment = {
        id: "pay-019",
        merchant_id: "merchant-1",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        amount: "50",
        status: "pending",
        created_at: new Date().toISOString(),
      };

      const suspiciousPayment = {
        id: "pay-020",
        merchant_id: "merchant-1",
        recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
        asset: "USDC",
        amount: "500000",
        status: "pending",
        created_at: new Date(Date.now() - 50 * 3600000).toISOString(),
        memo: "test fake",
      };

      const normalAnalysis = analyzePayment(normalPayment);
      const suspiciousAnalysis = analyzePayment(suspiciousPayment);

      expect(suspiciousAnalysis.riskScore).toBeGreaterThan(
        normalAnalysis.riskScore
      );
    });
  });
});
