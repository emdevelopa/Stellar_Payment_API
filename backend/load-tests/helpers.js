import autocannon from "autocannon";

export async function runAutocannon(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url,
        duration: 10,
        connections: 5,
        ...opts,
      },
      (err, results) => {
        if (err) return reject(err);
        resolve(results);
      },
    );
    autocannon.track(instance, { renderProgressBar: false });
  });
}

export function formatResults(title, results) {
  const lines = [
    `\n=== ${title} ===`,
    `  Duration:      ${results.duration}s`,
    `  Connections:   ${results.connections}`,
    `  Pipelining:    ${results.pipelining}`,
    `  Requests:      ${results.requests.total} (${results.requests.average} req/s)`,
    `  Throughput:    ${(results.throughput.total / 1024 / 1024).toFixed(2)} MB`,
    `  Errors:        ${results.errors}`,
    `  Timeouts:      ${results.timeouts}`,
    `  Status codes:  ${JSON.stringify(results.statusCodeStats)}`,
    `  Latency (ms):`,
    `    min:   ${results.latency.min}`,
    `    p1:    ${results.latency.p1}`,
    `    p2.5:  ${results.latency.p2_5}`,
    `    p50:   ${results.latency.p50}`,
    `    p75:   ${results.latency.p75}`,
    `    p90:   ${results.latency.p90}`,
    `    p97.5: ${results.latency.p97_5}`,
    `    p99:   ${results.latency.p99}`,
    `    max:   ${results.latency.max}`,
    `  Non-2xx:      ${results.non2xx}`,
    `  1xx: ${results["1xx"]}  2xx: ${results["2xx"]}  3xx: ${results["3xx"]}  4xx: ${results["4xx"]} 5xx: ${results["5xx"]}`,
  ];
  return lines.join("\n");
}

export function assertLoadTestThresholds(results, thresholds) {
  const rps = results.requests.average;
  const errorRate =
    results.requests.total > 0
      ? ((results.non2xx / results.requests.total) * 100).toFixed(2)
      : 0;
  const p95 = results.latency.p95 || results.latency.p97_5;

  const assertions = [];

  if (rps < thresholds.minRequestsPerSecond) {
    assertions.push(
      `Throughput too low: ${rps.toFixed(1)} req/s (min: ${thresholds.minRequestsPerSecond})`,
    );
  }

  if (errorRate > thresholds.maxErrorRatePercent) {
    assertions.push(
      `Error rate too high: ${errorRate}% (max: ${thresholds.maxErrorRatePercent}%)`,
    );
  }

  if (p95 > thresholds.maxP95LatencyMs) {
    assertions.push(
      `P95 latency too high: ${p95}ms (max: ${thresholds.maxP95LatencyMs}ms)`,
    );
  }

  return assertions;
}
