import express from "express";
import rateLimit from "express-rate-limit";
import { paymentService } from "../services/paymentService.js";
import { validateUuidParam } from "../lib/validate-uuid.js";
import { parseVersionedPaymentBody } from "../lib/request-schemas.js";
import { createCreatePaymentRateLimit } from "../lib/create-payment-rate-limit.js";

const createPaymentRateLimit = createCreatePaymentRateLimit();

const defaultVerifyPaymentRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many verification requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

function createPaymentsRouter({
  verifyPaymentRateLimit = defaultVerifyPaymentRateLimit,
} = {}) {
  const router = express.Router();

  /**
   * @swagger
   * /api/create-payment:
   *   post:
   *     summary: Create a new payment session request
   *     tags: [Payments]
   */
  async function createSession(req, res, next) {
    try {
      const body = parseVersionedPaymentBody(req);
      const result = await paymentService.createSession(req.merchant, body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  router.post("/create-payment", createPaymentRateLimit, createSession);
  router.post("/sessions", createPaymentRateLimit, createSession);

  /**
   * @swagger
   * /api/payment-status/{id}:
   *   get:
   *     summary: Get the status of a payment
   *     tags: [Payments]
   */
  router.get(
    "/payment-status/:id",
    validateUuidParam(),
    async (req, res, next) => {
      try {
        const merchantId = req.merchant?.id || null;
        const result = await paymentService.getStatus(req.params.id, merchantId);
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * @swagger
   * /api/verify-payment/{id}:
   *   post:
   *     summary: Verify a payment on the Stellar network
   *     tags: [Payments]
   */
  router.post(
    "/verify-payment/:id",
    verifyPaymentRateLimit,
    validateUuidParam(),
    async (req, res, next) => {
      try {
        const merchantId = req.merchant?.id || null;
        const result = await paymentService.verifyPayment(req.params.id, merchantId, req.app);
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * @swagger
   * /api/payments:
   *   get:
   *     summary: Get paginated list of payments
   *     tags: [Payments]
   */
  router.get("/payments", async (req, res, next) => {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 10;
      const result = await paymentService.getPayments(req.merchant.id, page, limit);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/metrics/7day:
   *   get:
   *     summary: Get 7-day rolling metrics
   *     tags: [Metrics]
   */
  router.get("/metrics/7day", async (req, res, next) => {
    try {
      const result = await paymentService.get7DayMetrics(req.merchant.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/payments/{id}/refund:
   *   post:
   *     summary: Generate a refund transaction
   *     tags: [Payments]
   */
  router.post(
    "/payments/:id/refund",
    validateUuidParam(),
    async (req, res, next) => {
      try {
        const result = await paymentService.generateRefund(req.params.id, req.merchant.id);
        res.json({
          ...result,
          instructions: "Sign this transaction with your merchant wallet and submit to Stellar network. Then call POST /api/payments/:id/refund/confirm with the transaction hash.",
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * @swagger
   * /api/payments/{id}/refund/confirm:
   *   post:
   *     summary: Confirm a refund transaction
   *     tags: [Payments]
   */
  router.post(
    "/payments/:id/refund/confirm",
    validateUuidParam(),
    async (req, res, next) => {
      try {
        const { tx_hash } = req.body;
        if (!tx_hash) {
          return res.status(400).json({ error: "Transaction hash required" });
        }
        const result = await paymentService.confirmRefund(req.params.id, req.merchant.id, tx_hash);
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * @swagger
   * /api/path-payment-quote/{id}:
   *   get:
   *     summary: Get a path payment quote
   *     tags: [Payments]
   */
  router.get(
    "/path-payment-quote/:id",
    validateUuidParam(),
    async (req, res, next) => {
      try {
        const { source_asset, source_asset_issuer, source_account } = req.query;
        if (!source_asset || !source_account) {
          return res.status(400).json({ error: "source_asset and source_account are required" });
        }
        const merchantId = req.merchant?.id || null;
        const result = await paymentService.getPathQuote(
          req.params.id,
          merchantId,
          source_asset,
          source_asset_issuer || null,
          source_account
        );
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}

export default createPaymentsRouter;
