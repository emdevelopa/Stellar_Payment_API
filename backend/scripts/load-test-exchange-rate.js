import autocannon from "autocannon";
import { createServer } from "http";
import { once } from "events";

const TARGET_URL = process.env.TARGET_URL || "http://127.0.0.1:3000";
const DURATION = parseInt(process.env.DURATION || "30", 10);
const CONNECTIONS = parseInt(process.env.CONNECTIONS || "10", 10);

const scenarios = {
  quote: {
    title: "Path Payment Quote — Success",
    requests: [
      {
        method: "GET",
        path: "/api/path-payment-quote/00000000-0000-0000-0000-000000000001?source_asset=XLM",
      },
    ],
  },
  rateLimit: {
    title: "Path Payment Quote — Rate Limit Threshold",
    requests: Array.from({ length: 120 }, (_, i) => ({
      method: "GET",
      path: `/api/path-payment-quote/00000000-0000-0000-0000-000000000001?source_asset=XLM`,
    })),
  },
  burst: {
    title: "Path Payment Quote — Burst 25 Connections",
    requests: [
      {
        method: "GET",
        path: "/api/path-payment-quote/00000000-0000-0000-0000-000000000001?source_asset=XLM",
      },
    ],
  },
};

async function runScenario(name, opts) {
  console.log(`\n=== ${opts.title} ===`);
  console.log(`Target: ${TARGET_URL}`);
  console.log(`Duration: ${DURATION}s, Connections: ${CONNECTIONS}`);

  const result = await new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: TARGET_URL,
        duration: DURATION,
        connections: CONNECTIONS,
        requests: opts.requests,
        reconnectRate: 10,
      },
      (err, res) => {
        if (err) reject(err);
        else resolve(res);
      },
    );
    autocannon.track(instance, { renderProgressBar: true });
  });

  console.log(`\nResults for "${opts.title}":`);
  console.log(`  Requests: ${result.requests.total} (${result.requests.average} req/s)`);
  console.log(`  Throughput: ${(result.throughput.total / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Errors: ${result.errors}`);
  console.log(`  Timeouts: ${result.timeouts}`);
  console.log(`  Non-2xx: ${result.non2xx}`);
  console.log(`  Status codes: ${JSON.stringify(result.statusCodeStats)}`);
  console.log(`  Latency (ms):`);
  console.log(`    min: ${result.latency.min}  p50: ${result.latency.p50}  p90: ${result.latency.p90}  p99: ${result.latency.p99}  max: ${result.latency.max}`);

  if (result.non2xx > result.requests.total * 0.1) {
    console.warn(`  ⚠ High error rate: ${((result.non2xx / result.requests.total) * 100).toFixed(1)}%`);
  }

  return result;
}

async function main() {
  const scenarioName = process.argv[2];

  if (scenarioName && scenarios[scenarioName]) {
    await runScenario(scenarioName, scenarios[scenarioName]);
  } else if (scenarioName) {
    console.error(`Unknown scenario: ${scenarioName}`);
    console.error(`Available: ${Object.keys(scenarios).join(", ")}`);
    process.exit(1);
  } else {
    const results = {};
    for (const [name, opts] of Object.entries(scenarios)) {
      results[name] = await runScenario(name, opts);
    }
    console.log("\n=== SUMMARY ===");
    for (const [name, result] of Object.entries(results)) {
      console.log(`  ${scenarios[name].title}: ${result.requests.average.toFixed(1)} req/s, p99: ${result.latency.p99}ms, errors: ${result.errors}`);
    }
  }
}

main().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});
