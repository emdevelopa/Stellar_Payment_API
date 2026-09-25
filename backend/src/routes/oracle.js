import { Router } from "express";
import { oracleIntegrator, createDefaultIntegrator } from "../lib/oracle-cache.js";
import { logger } from "../lib/logger.js";

const router = Router();

function getIntegrator(req) {
  return req.app.locals.oracleIntegrator || oracleIntegrator;
}

router.get("/api/oracle/:provider/:feed", async (req, res) => {
  try {
    const { provider, feed } = req.params;
    const params = req.query || {};
    const integrator = getIntegrator(req);
    const result = await integrator.fetch(provider, feed, params);
    res.json(result);
  } catch (err) {
    if (err.message.includes("Unknown oracle provider")) {
      res.status(400).json({ error: err.message });
    } else if (err.message.includes("Circuit breaker open")) {
      res.status(503).json({ error: err.message, retryAfter: 30 });
    } else {
      logger.error({ err: err.message, provider: req.params.provider, feed: req.params.feed }, "Oracle fetch failed");
      res.status(502).json({ error: "Oracle provider fetch failed", detail: err.message });
    }
  }
});

router.get("/api/oracle/stats", async (req, res) => {
  const integrator = getIntegrator(req);
  const stats = integrator.getStats();
  const { getCircuitBreakerMetrics } = await import("../lib/oracle-cache.js");
  res.json({ caches: stats, circuitBreakers: getCircuitBreakerMetrics() });
});

router.post("/api/oracle/clear", (req, res) => {
  const integrator = getIntegrator(req);
  const cleared = integrator.clearAllCaches();
  logger.info({ clearedEntries: cleared }, "Oracle caches cleared via API");
  res.json({ ok: true, clearedEntries: cleared });
});

router.post("/api/oracle/invalidate", (req, res) => {
  const { provider, feed, params } = req.body || {};
  if (!provider || !feed) {
    return res.status(400).json({ error: "provider and feed are required" });
  }
  const integrator = getIntegrator(req);
  const count = integrator.invalidateCache(provider, feed, params || {});
  res.json({ ok: true, invalidated: count });
});

export default router;
