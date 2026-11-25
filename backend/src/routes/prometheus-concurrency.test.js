import express from "express";
import request from "supertest";
import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/logger.js", () => ({ logger: { error: vi.fn() } }));

import { createPrometheusRouter } from "./prometheus.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createApp(registries) {
  const app = express();
  app.use(createPrometheusRouter(registries, "text/plain; version=0.0.4"));
  return app;
}

describe("Prometheus scrape concurrency", () => {
  it("coalesces concurrent requests into one complete metrics snapshot", async () => {
    const gate = createDeferred();
    const core = { metrics: vi.fn(async () => { await gate.promise; return "core_metrics"; }) };
    const payments = { metrics: vi.fn(async () => { await gate.promise; return "payment_metrics"; }) };
    const app = createApp([core, payments]);
    const requests = Array.from({ length: 10 }, () =>
      request(app).get("/metrics").then((response) => response),
    );

    await vi.waitFor(() => {
      expect(core.metrics).toHaveBeenCalledOnce();
      expect(payments.metrics).toHaveBeenCalledOnce();
    });
    gate.resolve();

    const responses = await Promise.all(requests);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.text).toBe("core_metrics\npayment_metrics");
      expect(response.headers["content-type"]).toContain("text/plain");
    }
    expect(core.metrics).toHaveBeenCalledOnce();
    expect(payments.metrics).toHaveBeenCalledOnce();
  });

  it("returns no partial snapshot on failure and allows a later retry", async () => {
    const broken = {
      metrics: vi.fn()
        .mockRejectedValueOnce(new Error("internal collector details"))
        .mockResolvedValueOnce("recovered_metrics"),
    };
    const app = createApp([broken]);

    const failed = await request(app).get("/metrics");
    expect(failed.status).toBe(500);
    expect(failed.text).toBe("Metrics temporarily unavailable");
    expect(failed.text).not.toContain("internal collector details");

    const recovered = await request(app).get("/metrics");
    expect(recovered.status).toBe(200);
    expect(recovered.text).toBe("recovered_metrics");
    expect(broken.metrics).toHaveBeenCalledTimes(2);
  });
});