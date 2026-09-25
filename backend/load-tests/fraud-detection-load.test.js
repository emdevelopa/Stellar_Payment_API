import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import autocannon from "autocannon";
import { analyzePayment, resetMetrics, getCacheStats } from "../src/lib/fraud-detection-engine.js";

vi.mock("../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../src/lib/metrics.js", () => ({
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

const TEST_PAYMENT_TEMPLATES = {
  normal: {
    merchant_id: "merchant-1",
    recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
    asset: "USDC",
    amount: "100",
    status: "pending",
    created_at: new Date().toISOString(),
  },
  largeAmount: {
    merchant_id: "merchant-1",
    recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
    asset: "USDC",
    amount: "500000",
    status: "pending",
    created_at: new Date().toISOString(),
  },
  stale: {
    merchant_id: "merchant-1",
    recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
    asset: "USDC",
    amount: "100",
    status: "pending",
    created_at: new Date(Date.now() - 80 * 3600000).toISOString(),
  },
  suspicious: {
    merchant_id: "merchant-1",
    recipient: "GBRPYHIL2CI3WHZDTOOQFC6EB4RBMAJVMBARWIOYBETLWGEFRES4KXO4",
    asset: "USDC",
    amount: "100",
    status: "pending",
    created_at: new Date().toISOString(),
    memo: "test fake admin",
  },
  invalid: {
    merchant_id: "merchant-1",
    recipient: "invalid-address",
    asset: "USDC",
    amount: "100",
    status: "pending",
    created_at: new Date().toISOString(),
  },
};

describe("Fraud Detection Engine Load Tests", () => {
  beforeAll(() => {
    resetMetrics();
  });

  afterAll(() => {
    resetMetrics();
  });

  describe("throughput performance", () => {
    it("processes 10,000 normal payments within acceptable latency", async () => {
      const startTime = Date.now();
      const iterations = 10000;

      for (let i = 0; i < iterations; i++) {
        const payment = {
          ...TEST_PAYMENT_TEMPLATES.normal,
          id: `pay-${i}`,
        };
        analyzePayment(payment);
      }

      const duration = Date.now() - startTime;
      const throughput = (iterations / duration) * 1000;
      const avgLatency = duration / iterations;

      console.log(`\n=== Fraud Detection Engine Load Test Results ===`);
      console.log(`Total iterations: ${iterations}`);
        console.log(`Total duration: ${duration}ms`);
      console.log(`Throughput: ${throughput.toFixed(2)} payments/sec`);
      console.log(`Average latency: ${avgLatency.toFixed(3)}ms per payment`);

      expect(throughput).toBeGreaterThan(1000);
      expect(avgLatency).toBeLessThan(10);
    }, 60000);

    it("handles mixed payload types with consistent performance", async () => {
      const startTime = Date.now();
      const iterations = 5000;
      const paymentTypes = Object.keys(TEST_PAYMENT_TEMPLATES);
      const results = {
        processed: 0,
        errors: 0,
        riskLevels: { low: 0, medium: 0, high: 0, critical: 0 },
      };

      for (let i = 0; i < iterations; i++) {
        const paymentType = paymentTypes[i % paymentTypes.length];
        const payment = {
          ...TEST_PAYMENT_TEMPLATES[paymentType],
          id: `pay-mixed-${i}`,
        };

        try {
          const analysis = analyzePayment(payment);
          results.processed++;
          results.riskLevels[analysis.riskLevel]++;
        } catch (error) {
          results.errors++;
        }
      }

      const duration = Date.now() - startTime;
      const throughput = (results.processed / duration) * 1000;

      console.log(`\n=== Mixed Payload Load Test ===`);
      console.log(`Processed: ${results.processed} / ${iterations}`);
      console.log(`Errors: ${results.errors}`);
      console.log(`Throughput: ${throughput.toFixed(2)} payments/sec`);
      console.log(`Risk Level Distribution:`, results.riskLevels);

      expect(results.errors).toBe(0);
      expect(throughput).toBeGreaterThan(500);
    }, 60000);

    it("maintains cache performance under load", async () => {
      resetMetrics();
      const iterations = 1000;
      const uniquePayments = 100;

      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        const paymentIndex = i % uniquePayments;
        const payment = {
          ...TEST_PAYMENT_TEMPLATES.normal,
          id: `pay-cache-${paymentIndex}`,
          merchant_id: `merchant-${Math.floor(paymentIndex / 20)}`,
        };
        analyzePayment(payment);
      }

      const duration = Date.now() - startTime;
      const throughput = (iterations / duration) * 1000;
      const stats = getCacheStats();

      console.log(`\n=== Cache Performance Test ===`);
      console.log(`Total iterations: ${iterations}`);
      console.log(`Unique payments: ${uniquePayments}`);
      console.log(`Duration: ${duration}ms`);
      console.log(`Throughput: ${throughput.toFixed(2)} payments/sec`);
      console.log(`Cache size: ${stats.cacheSize} entries`);
      console.log(`Velocity tracker size: ${stats.velocityTrackerSize} entries`);

      expect(stats.cacheSize).toBeLessThanOrEqual(uniquePayments + 1);
      expect(throughput).toBeGreaterThan(500);
    }, 60000);

    it("handles burst traffic (1000 payments in rapid succession)", async () => {
      const burstSize = 1000;
      const startTime = Date.now();

      for (let i = 0; i < burstSize; i++) {
        const payment = {
          ...TEST_PAYMENT_TEMPLATES.normal,
          id: `pay-burst-${i}`,
        };
        analyzePayment(payment);
      }

      const duration = Date.now() - startTime;
      const avgLatency = duration / burstSize;

      console.log(`\n=== Burst Traffic Test ===`);
      console.log(`Burst size: ${burstSize} payments`);
      console.log(`Duration: ${duration}ms`);
      console.log(`Average latency: ${avgLatency.toFixed(3)}ms`);

      expect(avgLatency).toBeLessThan(5);
    }, 30000);
  });

  describe("memory efficiency", () => {
    it("manages memory with cache expiration", async () => {
      resetMetrics();
      const paymentCount = 10000;

      for (let i = 0; i < paymentCount; i++) {
        const payment = {
          ...TEST_PAYMENT_TEMPLATES.normal,
          id: `pay-memory-${i}`,
          merchant_id: `merchant-${i % 100}`,
        };
        analyzePayment(payment);
      }

      const stats = getCacheStats();

      console.log(`\n=== Memory Efficiency Test ===`);
      console.log(`Payments analyzed: ${paymentCount}`);
      console.log(`Cache entries: ${stats.cacheSize}`);
      console.log(`Cache efficiency: ${((stats.cacheSize / paymentCount) * 100).toFixed(2)}%`);

      expect(stats.cacheSize).toBeLessThan(paymentCount);
    }, 60000);
  });

  describe("anomaly detection performance", () => {
    it("efficiently detects various anomaly types", async () => {
      const results = {
        normal: { count: 0, avgScore: 0 },
        largeAmount: { count: 0, avgScore: 0 },
        stale: { count: 0, avgScore: 0 },
        suspicious: { count: 0, avgScore: 0 },
        invalid: { count: 0, avgScore: 0 },
      };

      const startTime = Date.now();

      for (let i = 0; i < 2000; i++) {
        const paymentTypes = Object.keys(TEST_PAYMENT_TEMPLATES);
        const paymentType = paymentTypes[i % paymentTypes.length];
        const payment = {
          ...TEST_PAYMENT_TEMPLATES[paymentType],
          id: `pay-anomaly-${i}`,
        };

        const analysis = analyzePayment(payment);
        results[paymentType].count++;
        results[paymentType].avgScore += analysis.riskScore;
      }

      const duration = Date.now() - startTime;

      Object.keys(results).forEach((type) => {
        results[type].avgScore /= results[type].count;
      });

      console.log(`\n=== Anomaly Detection Performance ===`);
      console.log(`Total time: ${duration}ms`);
      console.log(`Anomaly type scores:`);
      Object.entries(results).forEach(([type, data]) => {
        console.log(
          `  ${type}: count=${data.count}, avgScore=${data.avgScore.toFixed(2)}`
        );
      });

      expect(duration).toBeLessThan(30000);
    }, 60000);
  });

  describe("stress testing", () => {
    it("handles extreme scenario: all high-risk payments", async () => {
      const iterations = 5000;
      let blockedCount = 0;

      for (let i = 0; i < iterations; i++) {
        const payment = {
          ...TEST_PAYMENT_TEMPLATES.invalid,
          id: `pay-stress-${i}`,
          amount: (1000 + i * 100).toString(),
          created_at: new Date(Date.now() - (i % 100) * 3600000).toISOString(),
        };

        const analysis = analyzePayment(payment);
        if (analysis.isBlocked) blockedCount++;
      }

      console.log(`\n=== Stress Test: High-Risk Payments ===`);
      console.log(`Total payments: ${iterations}`);
      console.log(`Blocked payments: ${blockedCount}`);
      console.log(`Block rate: ${((blockedCount / iterations) * 100).toFixed(2)}%`);

      expect(blockedCount).toBeGreaterThan(0);
    }, 60000);

    it("handles different merchant patterns", async () => {
      const merchantCount = 50;
      const paymentsPerMerchant = 200;
      const results = {};

      for (let m = 0; m < merchantCount; m++) {
        results[`merchant-${m}`] = { count: 0, avgScore: 0 };

        for (let p = 0; p < paymentsPerMerchant; p++) {
          const payment = {
            ...TEST_PAYMENT_TEMPLATES.normal,
            id: `pay-merchant-${m}-${p}`,
            merchant_id: `merchant-${m}`,
          };

          const analysis = analyzePayment(payment);
          results[`merchant-${m}`].count++;
          results[`merchant-${m}`].avgScore += analysis.riskScore;
        }

        results[`merchant-${m}`].avgScore /= paymentsPerMerchant;
      }

      console.log(`\n=== Multi-Merchant Pattern Test ===`);
      console.log(
        `Merchants: ${merchantCount}, Payments per merchant: ${paymentsPerMerchant}`
      );
      console.log(
        `Total payments: ${merchantCount * paymentsPerMerchant}`
      );
      console.log(`Average score across merchants:`);

      const scores = Object.values(results).map((r) => r.avgScore);
      const avgScore = scores.reduce((a, b) => a + b) / scores.length;
      console.log(`  Mean: ${avgScore.toFixed(2)}, StdDev: ${calculateStdDev(scores).toFixed(2)}`);

      expect(results).toHaveProperty(`merchant-0`);
      expect(Object.keys(results).length).toBe(merchantCount);
    }, 120000);
  });
});

function calculateStdDev(values) {
  const mean = values.reduce((a, b) => a + b) / values.length;
  const squareDiffs = values.map((value) => Math.pow(value - mean, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b) / values.length;
  return Math.sqrt(avgSquareDiff);
}
