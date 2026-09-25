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

const router = express.Router();

/**
 * @swagger
 * /metrics:
 *   get:
 *     summary: Expose Prometheus metrics
 *     description: Returns the current state of Prometheus metrics for the application, including granular payment processor, trustline manager and path payment metrics.
 *     tags: [Monitoring]
 *     responses:
 *       200:
 *         description: Prometheus metrics formatted for scraping
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 */
router.get("/metrics", async (req, res) => {
  try {
    const [coreMetrics, processorMetrics, trustlineMetrics, pathPaymentMetrics] =
      await Promise.all([
        register.metrics(),
        paymentProcessorRegister.metrics(),
        trustlineManagerRegister.metrics(),
        pathPaymentRegister.metrics(),
      ]);
    res.set("Content-Type", register.contentType);
    res.end(
      `${coreMetrics}\n${processorMetrics}\n${trustlineMetrics}\n${pathPaymentMetrics}`,
    );
  } catch (err) {
    res.status(500).end(err);
  }
});

export default router;
