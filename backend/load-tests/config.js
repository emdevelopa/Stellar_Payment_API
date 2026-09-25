export const LOAD_TEST_DEFAULTS = {
  duration: 30,
  connections: 10,
  pipelining: 1,
  timeout: 10,
};

export const EXCHANGE_RATE_SCENARIOS = {
  quoteSuccess: {
    name: "Path Payment Quote — Success",
    description: "Simulates concurrent requests for valid path payment quotes",
    duration: 30,
    connections: 10,
    requests: [
      {
        method: "GET",
        path: "/api/path-payment-quote/00000000-0000-0000-0000-000000000001",
        query: {
          source_asset: "XLM",
          source_asset_issuer: "",
          source_account: "",
        },
      },
    ],
  },
  quoteNotFound: {
    name: "Path Payment Quote — 404",
    description: "Simulates requests for non-existent payment IDs",
    duration: 15,
    connections: 5,
    requests: [
      {
        method: "GET",
        path: "/api/path-payment-quote/ffffffff-ffff-ffff-ffff-ffffffffffff",
        query: {
          source_asset: "XLM",
        },
      },
    ],
  },
  rateLimited: {
    name: "Path Payment Quote — Rate Limited",
    description: "Tests rate limiter behavior under high frequency requests",
    duration: 5,
    connections: 1,
    requests: [
      {
        method: "GET",
        path: "/api/path-payment-quote/00000000-0000-0000-0000-000000000001",
        query: {
          source_asset: "XLM",
        },
      },
    ],
  },
};

export const THROUGHPUT_THRESHOLDS = {
  minRequestsPerSecond: 5,
  maxErrorRatePercent: 10,
  maxP95LatencyMs: 5000,
};
