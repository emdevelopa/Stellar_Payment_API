import { describe, it, expect } from "vitest";
import { LOAD_TEST_DEFAULTS, THROUGHPUT_THRESHOLDS } from "./config.js";

const ADMIN_DASHBOARD_SCENARIOS = [
  {
    name: "dashboard overview",
    path: "/api/admin/dashboard",
    duration: LOAD_TEST_DEFAULTS.duration,
    connections: LOAD_TEST_DEFAULTS.connections,
  },
  {
    name: "dashboard payments feed",
    path: "/api/admin/dashboard/payments",
    duration: LOAD_TEST_DEFAULTS.duration,
    connections: LOAD_TEST_DEFAULTS.connections,
  },
  {
    name: "dashboard metrics summary",
    path: "/api/admin/dashboard/metrics",
    duration: LOAD_TEST_DEFAULTS.duration,
    connections: LOAD_TEST_DEFAULTS.connections,
  },
];

describe("Admin Dashboard Service load-test plan", () => {
  it("documents dashboard load scenarios and acceptance thresholds", () => {
    expect(ADMIN_DASHBOARD_SCENARIOS).toHaveLength(3);
    for (const scenario of ADMIN_DASHBOARD_SCENARIOS) {
      expect(scenario.path).toMatch(/^\/api\/admin\/dashboard/);
      expect(scenario.duration).toBeGreaterThan(0);
      expect(scenario.connections).toBeGreaterThan(0);
    }
    expect(THROUGHPUT_THRESHOLDS.minRequestsPerSecond).toBeGreaterThan(0);
    expect(THROUGHPUT_THRESHOLDS.maxP95LatencyMs).toBeLessThanOrEqual(5000);
  });
});
