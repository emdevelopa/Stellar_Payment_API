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

const router = express.Router();

/**
 * @swagger
 * /metrics:
 *   get:
 *     summary: Expose Prometheus metrics
 *     description: Returns the current state of Prometheus metrics for the application, including granular payment processor, trustline manager, path payment and payment session validator metrics.
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
    const scrapes = await Promise.all([
      register.metrics(),
      paymentProcessorRegister.metrics(),
      trustlineManagerRegister.metrics(),
      pathPaymentRegister.metrics(),
      paymentSessionValidatorRegister.metrics(),
    ]);
    res.set("Content-Type", register.contentType);
    res.end(scrapes.join("\n"));
  } catch (err) {
    res.status(500).end(err);
  }
});

export default router;
