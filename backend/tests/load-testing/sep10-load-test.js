import http from "http";
import { generateChallenge, verifyChallenge, generateSessionToken, verifySessionToken } from "../../src/lib/sep10-auth.js";
import * as StellarSdk from "stellar-sdk";

const NETWORK = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
const NETWORK_PASSPHRASE =
  NETWORK === "public"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const NUM_CONCURRENT_REQUESTS = parseInt(process.env.NUM_CONCURRENT || "10", 10);
const NUM_ITERATIONS = parseInt(process.env.NUM_ITERATIONS || "100", 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "5", 10);

class LoadTestMetrics {
  constructor() {
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.responseTimes = [];
    this.errors = [];
    this.startTime = null;
    this.endTime = null;
  }

  recordRequest(duration, success, error = null) {
    this.totalRequests += 1;
    if (success) {
      this.successfulRequests += 1;
    } else {
      this.failedRequests += 1;
      if (error) this.errors.push(error);
    }
    this.responseTimes.push(duration);
  }

  getAverageResponseTime() {
    if (this.responseTimes.length === 0) return 0;
    const total = this.responseTimes.reduce((a, b) => a + b, 0);
    return total / this.responseTimes.length;
  }

  getPercentile(percentile) {
    if (this.responseTimes.length === 0) return 0;
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  getThroughput() {
    if (!this.startTime || !this.endTime) return 0;
    const seconds = (this.endTime - this.startTime) / 1000;
    return seconds > 0 ? this.successfulRequests / seconds : 0;
  }

  print() {
    console.log("\n========================================");
    console.log("SEP-10 Load Test Results");
    console.log("========================================");
    console.log(`Total Requests: ${this.totalRequests}`);
    console.log(`Successful: ${this.successfulRequests}`);
    console.log(`Failed: ${this.failedRequests}`);
    console.log(`Success Rate: ${((this.successfulRequests / this.totalRequests) * 100).toFixed(2)}%`);
    console.log(`\nResponse Times (ms):`);
    console.log(`  Average: ${this.getAverageResponseTime().toFixed(2)}`);
    console.log(`  Min: ${Math.min(...this.responseTimes)}`);
    console.log(`  Max: ${Math.max(...this.responseTimes)}`);
    console.log(`  P50: ${this.getPercentile(50).toFixed(2)}`);
    console.log(`  P95: ${this.getPercentile(95).toFixed(2)}`);
    console.log(`  P99: ${this.getPercentile(99).toFixed(2)}`);
    console.log(`\nThroughput: ${this.getThroughput().toFixed(2)} requests/sec`);
    console.log(`Total Duration: ${((this.endTime - this.startTime) / 1000).toFixed(2)}s`);

    if (this.errors.length > 0) {
      console.log(`\nTop Errors:`);
      const errorCounts = {};
      this.errors.forEach((err) => {
        errorCounts[err] = (errorCounts[err] || 0) + 1;
      });
      Object.entries(errorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([err, count]) => {
          console.log(`  ${err}: ${count}`);
        });
    }
    console.log("========================================\n");
  }
}

function generateTestKeyPair() {
  return StellarSdk.Keypair.random();
}

async function testChallengeGeneration(metrics) {
  const keypair = generateTestKeyPair();
  const startTime = Date.now();

  try {
    const challenge = generateChallenge(keypair.publicKey());
    const duration = Date.now() - startTime;
    metrics.recordRequest(duration, !!challenge);
    return challenge;
  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.recordRequest(duration, false, error.message);
    return null;
  }
}

async function testChallengeVerification(metrics, challengeXdr, keypair) {
  const tx = StellarSdk.TransactionBuilder.fromXDR(
    challengeXdr,
    NETWORK_PASSPHRASE,
  );
  tx.sign(keypair);
  const signedXdr = tx.toXDR();

  const startTime = Date.now();

  try {
    const result = verifyChallenge(signedXdr, keypair.publicKey());
    const duration = Date.now() - startTime;
    const success = result.valid;
    metrics.recordRequest(duration, success, success ? null : result.error);
    return success;
  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.recordRequest(duration, false, error.message);
    return false;
  }
}

async function testSessionToken(metrics) {
  const merchantId = crypto.randomUUID();
  const email = `merchant-${Math.random().toString(36).slice(2)}@test.com`;

  const startTime = Date.now();

  try {
    const token = generateSessionToken(merchantId, email);
    const verification = verifySessionToken(token);
    const duration = Date.now() - startTime;
    metrics.recordRequest(duration, verification.valid);
    return verification.valid;
  } catch (error) {
    const duration = Date.now() - startTime;
    metrics.recordRequest(duration, false, error.message);
    return false;
  }
}

async function testAPIChallengeEndpoint(metrics) {
  const keypair = generateTestKeyPair();
  const startTime = Date.now();

  return new Promise((resolve) => {
    const postData = JSON.stringify({ account: keypair.publicKey() });

    const options = {
      hostname: new URL(API_BASE_URL).hostname,
      port: new URL(API_BASE_URL).port || 80,
      path: "/api/auth/challenge",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      const duration = Date.now() - startTime;
      metrics.recordRequest(duration, res.statusCode === 200);
      res.on("data", () => {});
      res.on("end", () => resolve());
    });

    req.on("error", (error) => {
      const duration = Date.now() - startTime;
      metrics.recordRequest(duration, false, error.message);
      resolve();
    });

    req.write(postData);
    req.end();
  });
}

async function runConcurrentTests(testFn, metrics, batchSize) {
  const batches = Math.ceil(NUM_ITERATIONS / batchSize);

  for (let batch = 0; batch < batches; batch++) {
    const batchSize_actual = Math.min(batchSize, NUM_ITERATIONS - batch * batchSize);
    const promises = [];

    for (let i = 0; i < batchSize_actual; i++) {
      promises.push(testFn(metrics));
    }

    await Promise.all(promises);
    console.log(`Batch ${batch + 1}/${batches} completed (${(batch + 1) * batchSize_actual}/${NUM_ITERATIONS} requests)`);
  }
}

async function main() {
  console.log("SEP-10 Authentication Load Testing Suite");
  console.log("=========================================");
  console.log(`Configuration:`);
  console.log(`  Concurrent Requests: ${NUM_CONCURRENT_REQUESTS}`);
  console.log(`  Total Iterations: ${NUM_ITERATIONS}`);
  console.log(`  Batch Size: ${BATCH_SIZE}`);
  console.log(`  API Base URL: ${API_BASE_URL}`);
  console.log("");

  try {
    // Test 1: Challenge Generation
    console.log("Test 1: Challenge Generation Performance");
    const metricsChallenge = new LoadTestMetrics();
    metricsChallenge.startTime = Date.now();
    await runConcurrentTests(testChallengeGeneration, metricsChallenge, BATCH_SIZE);
    metricsChallenge.endTime = Date.now();
    metricsChallenge.print();

    // Test 2: Challenge Verification
    console.log("Test 2: Challenge Verification Performance");
    const metricsVerification = new LoadTestMetrics();
    metricsVerification.startTime = Date.now();

    for (let i = 0; i < NUM_ITERATIONS; i += BATCH_SIZE) {
      const batchSize_actual = Math.min(BATCH_SIZE, NUM_ITERATIONS - i);
      const promises = [];

      for (let j = 0; j < batchSize_actual; j++) {
        const keypair = generateTestKeyPair();
        const challenge = generateChallenge(keypair.publicKey());
        promises.push(testChallengeVerification(metricsVerification, challenge, keypair));
      }

      await Promise.all(promises);
      console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1} completed`);
    }

    metricsVerification.endTime = Date.now();
    metricsVerification.print();

    // Test 3: Session Token
    console.log("Test 3: Session Token Generation & Verification Performance");
    const metricsToken = new LoadTestMetrics();
    metricsToken.startTime = Date.now();
    await runConcurrentTests(testSessionToken, metricsToken, BATCH_SIZE);
    metricsToken.endTime = Date.now();
    metricsToken.print();

    // Test 4: API Endpoint Performance
    console.log("Test 4: API Challenge Endpoint Performance");
    const metricsAPI = new LoadTestMetrics();
    metricsAPI.startTime = Date.now();
    await runConcurrentTests(testAPIChallengeEndpoint, metricsAPI, BATCH_SIZE);
    metricsAPI.endTime = Date.now();
    metricsAPI.print();

    console.log("All load tests completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Load test error:", error);
    process.exit(1);
  }
}

main();
