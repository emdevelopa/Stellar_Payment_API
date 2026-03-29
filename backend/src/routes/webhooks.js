import express from "express";
import { merchantService } from "../services/merchantService.js";
import { requireApiKeyAuth } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { z } from "zod";
import { queueBulkWebhookRetries } from "../lib/webhook-retries.js";
import { generatePaginationLinks } from "../lib/pagination-links.js";

const router = express.Router();
const bulkRetrySchema = z.object({
  log_ids: z.array(z.string().uuid()).min(1).max(100),
});

/**
 * @swagger
 * /api/webhook-logs:
 *   get:
 *     summary: Get webhook delivery logs for authenticated merchant
 *     description: Retrieve paginated webhook delivery logs for the authenticated merchant account using cursor-based pagination
 *     tags: [Webhooks]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Pagination cursor (base64 encoded)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Number of logs per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [success, failure]
 *         description: Filter by success (2xx) or failure (non-2xx)
 *     responses:
 *       200:
 *         description: Paginated webhook logs
 *       401:
 *         description: Unauthorized - invalid or missing API key
 *       500:
 *         description: Server error
 */
router.get("/webhook-logs", async (req, res, next) => {
  try {
    const { cursor, limit, status } = req.query;
    const result = await merchantService.getWebhookLogs(req.merchant.id, {
      cursor,
      limit,
      status,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/webhooks/test:
 *   post:
 *     summary: Send a test webhook to the merchant's stored webhook URL
 *     tags: [Webhooks]
 *     security:
 *       - ApiKeyAuth: []
 */
router.post("/webhooks/test", requireApiKeyAuth(), async (req, res, next) => {
  try {
    const result = await merchantService.testWebhook(req.merchant, req.merchant.webhook_url);
    
    if (!req.merchant.webhook_url) {
      return res.status(400).json({ error: "No webhook URL configured for this merchant." });
    }

    res.json({
      ok: result.ok,
      status: result.status,
      body: result.body,
      signed: result.signed,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     summary: Get dashboard notifications
 *     tags: [Notifications]
 *     security:
 *       - ApiKeyAuth: []
 */
router.get("/notifications", requireApiKeyAuth(), async (req, res, next) => {
  try {
    const merchantId = req.merchant.id;
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const { count, error } = await supabase
      .from("webhook_delivery_logs")
      .select(`id, payments!inner(merchant_id)`, { count: 'exact', head: true })
      .eq("payments.merchant_id", merchantId)
      .gte("timestamp", twentyFourHoursAgo.toISOString())
      .or("status_code.lt.200,status_code.gte.300");

    if (error) throw error;

    res.json({
      notifications: (count || 0) > 5 ? [{
         id: "webhook-failures",
         message: `You have ${count} webhook delivery failures in the last 24 hours.`,
         type: "warning"
      }] : [],
      unreadCount: (count || 0) > 5 ? 1 : 0
    });
  } catch (err) {
    next(err);
  }
});

router.post("/webhooks/retry-bulk", async (req, res, next) => {
  try {
    const body = bulkRetrySchema.parse(req.body || {});
    const result = await queueBulkWebhookRetries({
      db: req.app.locals.pool,
      merchantId: req.merchant.id,
      logIds: body.log_ids,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
