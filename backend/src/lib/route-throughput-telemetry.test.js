import express from "express";
import request from "supertest";
import client from "prom-client";
import { beforeEach, describe, expect, it } from "vitest";
import { createRouteThroughputTelemetry, matchRoutePattern } from "./route-throughput-telemetry.js";

const registry = new client.Registry();
const requests = new client.Counter({ name: "t_requests_total", help: "h", labelNames: ["route", "method", "status_class"], registers: [registry] });
const duration = new client.Histogram({ name: "t_duration_seconds", help: "h", labelNames: ["route", "method"], registers: [registry] });
const inFlight = new client.Gauge({ name: "t_in_flight", help: "h", labelNames: ["route"], registers: [registry] });

function buildApp() {
  const router = express.Router();
  router.use(createRouteThroughputTelemetry({ router, requests, duration, inFlight }));
  router.get("/items/:id", (req, res) => res.json({ id: req.params.id }));
  router.post("/items", (_req, res) => res.status(201).json({}));
  router.get("/boom", () => {
    throw new Error("boom");
  });

  const other = express.Router();
  other.get("/other", (_req, res) => res.json({}));

  const app = express();
  app.use("/api", router);
  app.use("/api", other);
  // eslint-disable-next-line no-unused-vars
  app.use((_err, _req, res, _next) => res.status(500).json({ error: "x" }));
  return { app, router };
}

async function values(name) {
  return (await registry.getSingleMetric(name).get()).values;
}

beforeEach(() => {
  requests.reset();
  duration.reset();
  inFlight.reset();
});

describe("createRouteThroughputTelemetry", () => {
  it("labels by route pattern, method and status class, never by concrete id", async () => {
    const { app } = buildApp();
    await request(app).get("/api/items/123");
    await request(app).get("/api/items/456");
    await request(app).post("/api/items");
    await request(app).get("/api/boom");

    const counts = await values("t_requests_total");
    const get = counts.find((v) => v.labels.route === "/items/:id" && v.labels.method === "GET");
    expect(get.value).toBe(2);
    expect(get.labels.status_class).toBe("2xx");
    expect(counts.find((v) => v.labels.route === "/items").labels.status_class).toBe("2xx");
    expect(counts.find((v) => v.labels.route === "/boom").labels.status_class).toBe("5xx");
    expect(JSON.stringify(counts)).not.toContain("123");

    const hist = await values("t_duration_seconds");
    expect(hist.find((v) => v.metricName === "t_duration_seconds_count" && v.labels.route === "/items/:id").value).toBe(2);
  });

  it("ignores requests served by other routers on the same prefix, and unknown paths", async () => {
    const { app } = buildApp();
    await request(app).get("/api/other");
    await request(app).get("/api/nope");
    await request(app).delete("/api/items/1");
    expect(await values("t_requests_total")).toHaveLength(0);
  });

  it("returns the in-flight gauge to zero after responses", async () => {
    const { app } = buildApp();
    await Promise.all([request(app).get("/api/items/1"), request(app).get("/api/items/2")]);
    const gauge = await values("t_in_flight");
    expect(gauge.find((v) => v.labels.route === "/items/:id").value).toBe(0);
  });

  it("matchRoutePattern handles HEAD via GET routes", () => {
    const { router } = buildApp();
    expect(matchRoutePattern(router, { method: "HEAD", path: "/items/9" })).toBe("/items/:id");
    expect(matchRoutePattern(router, { method: "PUT", path: "/items/9" })).toBeNull();
  });
});
