import express from "express";
import { register } from "../lib/metrics.js";
// Granular Payment Processor metrics live in their own registry (issue #1088)
// and are merged into the scrape output below.
import { paymentProcessorRegister } from "../lib/payment-processor-metrics.js";
// Granular Trustline Manager metrics live in their own registry (issue #1043)
// and are merged into the scrape output below.
import { trustlineManagerRegister } from "../lib/trustline-manager-metrics.js";
// Granular Path Payment Service metrics live in their own registry (issue #1048)
// and are merged into the scrape output below.
import { pathPaymentRegister } from "../lib/path-payment-metrics.js";
// Payment Session Validator metrics live in their own registry (issue #1448)
// and are merged into the scrape output below.
import { paymentSessionValidatorRegister } from "../lib/payment-session-validator-metrics.js";
// Exchange Rate Oracle Cache alert metrics live in their own registry (issue #1443)
// and are merged into the scrape output below.
import { exchangeRateOracleRegister } from "../lib/exchange-rate-oracle-telemetry.js";
// Database Row-Level Security Service alert metrics live in their own registry (issue #1468)
// and are merged into the scrape output below.
import { dbRlsRegister } from "../lib/db-rls-telemetry.js";
// Stellar Account & Ledger Key Validator metrics live in their own registry (issue #1764)
// and are merged into the scrape output below.
import { validatorRegister } from "../lib/stellar/validators-metrics.js";
import { logger } from "../lib/logger.js";

const metricRegisters = [
  register,
  paymentProcessorRegister,
  trustlineManagerRegister,
  pathPaymentRegister,
  paymentSessionValidatorRegister,
  exchangeRateOracleRegister,
  dbRlsRegister,
  validatorRegister,
];

export function createPrometheusRouter(registries = metricRegisters, contentType = register.contentType) {
  const router = express.Router();
  let inFlightScrape = null;

  function scrapeMetrics() {
    if (!inFlightScrape) {
      inFlightScrape = Promise.allSettled(
        registries.map((registry) => Promise.resolve().then(() => registry.metrics())),
      )
        .then((results) => {
          const failure = results.find((result) => result.status === "rejected");
          if (failure) throw failure.reason;
          return results.map((result) => result.value).join("\n");
        })
        .finally(() => {
          inFlightScrape = null;
        });
    }
    return inFlightScrape;
  }

/**
 * @swagger
 * /metrics:
 *   get:
 *     summary: Expose Prometheus metrics
 *     description: Returns the current state of Prometheus metrics for the application, including granular payment processor, trustline manager, path payment, payment session validator, exchange-rate oracle cache and database row-level security metrics.
 *     tags: [Monitoring]
 *     responses:
 *       200:
 *         description: Prometheus metrics formatted for scraping
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 */
  router.get("/metrics", async (_req, res) => {
    try {
      const snapshot = await scrapeMetrics();
      res.set("Content-Type", contentType);
      res.end(snapshot);
    } catch (err) {
      logger.error({ err }, "Prometheus metrics collection failed");
      res.status(500).type("text/plain").end("Metrics temporarily unavailable");
    }
  });

  return router;
}

const router = createPrometheusRouter();

export default router;
