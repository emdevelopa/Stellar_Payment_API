import express from "express";
import { supabase } from "../lib/supabase.js";
import { sendWebhook } from "../lib/webhooks.js";

const router = express.Router();

/**
 * @swagger
 * /api/webhooks/test:
 *   post:
 *     summary: Send a test webhook to the merchant's stored webhook URL
 *     tags: [Webhooks]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Test webhook dispatched
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 status:
 *                   type: integer
 *                 body:
 *                   type: string
 *                 signed:
 *                   type: boolean
 *       400:
 *         description: No webhook URL configured
 *       401:
 *         description: Missing or invalid API key
 */

router.post("/webhooks/test", async (req, res, next) => {
  try {
    // 1. Fetch the merchant's webhook_url and webhook_secret from DB
    const { data: merchant, error } = await supabase
      .from("merchants")
      .select("webhook_url, webhook_secret")
      .eq("id", req.merchant.id)
      .maybeSingle();

    if (error) {
      error.status = 500;
      throw error;
    }

    // 2. Guard: merchant must have a webhook URL saved
    if (!merchant?.webhook_url) {
      return res.status(400).json({
        error: "No webhook URL configured for this merchant.",
      });
    }

    // 3. Build a dummy payload mimicking a real payment.confirmed event
    const dummyPayload = {
      event: "payment.confirmed",
      test: true,
      payment_id: "00000000-0000-0000-0000-000000000000",
      amount: "1.00",
      asset: "XLM",
      asset_issuer: null,
      recipient: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      tx_id: "test_tx_abc123",
    };

    // 4. Send the webhook using the existing sendWebhook utility
    const result = await sendWebhook(
      merchant.webhook_url,
      dummyPayload,
      merchant.webhook_secret
    );

    // 5. Return the result
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

export default router;