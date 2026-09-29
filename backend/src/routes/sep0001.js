import express from "express";
import { logger } from "../lib/logger.js";
import { getStellarTomlCoordinator } from "../lib/sep0001-toml-coordinator.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function etagMatches(header, etag) {
  if (!header) return false;
  return header
    .split(",")
    .map((value) => value.trim().replace(/^W\//, ""))
    .some((value) => value === "*" || value === etag);
}

/**
 * Build the SEP-0001 router.
 *
 * @param {object} [options]
 * @param {() => { getStellarToml: (merchantId: string) => Promise<object|null> }} [options.getCoordinator]
 */
export function createSep0001Router({ getCoordinator = getStellarTomlCoordinator } = {}) {
  const router = express.Router();

  /**
   * @swagger
   * /.well-known/stellar.toml:
   *   get:
   *     summary: Get SEP-0001 stellar.toml for merchant
   *     description: >
   *       Generation is coordinated across API instances (single-flight plus a
   *       Redis lock and shared cache) so bursts of requests for one merchant
   *       cause at most one database read. Responses carry a strong ETag and
   *       honour If-None-Match.
   *     tags: [SEP-0001]
   *     parameters:
   *       - in: query
   *         name: merchant_id
   *         schema:
   *           type: string
   *           format: uuid
   *         description: Merchant ID (optional, uses authenticated merchant if not provided)
   *     responses:
   *       200:
   *         description: SEP-0001 stellar.toml content
   *         content:
   *           text/plain:
   *             schema:
   *               type: string
   *       304:
   *         description: Not modified (If-None-Match matched the current ETag)
   *       400:
   *         description: merchant_id missing or not a UUID
   *       404:
   *         description: Merchant not found
   *       500:
   *         description: Failed to generate stellar.toml
   */
  router.get("/.well-known/stellar.toml", async (req, res, next) => {
    try {
      let merchantId = req.query.merchant_id;

      // If no merchant_id provided, use authenticated merchant
      if (!merchantId && req.merchant) {
        merchantId = req.merchant.id;
      }

      if (!merchantId) {
        return res.status(400).json({ error: "merchant_id required" });
      }

      if (typeof merchantId !== "string" || !UUID_PATTERN.test(merchantId)) {
        return res.status(400).json({ error: "merchant_id must be a valid UUID" });
      }

      const result = await getCoordinator().getStellarToml(merchantId.toLowerCase());

      if (!result) {
        return res.status(404).json({ error: "Merchant not found" });
      }

      const etag = `"${result.digest}"`;
      res.set({
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
        ETag: etag,
      });

      if (etagMatches(req.get("If-None-Match"), etag)) {
        return res.status(304).end();
      }

      res.send(result.toml);
    } catch (err) {
      logger.error({ err: err?.message }, "Error generating stellar.toml");
      if (err?.status === 500) {
        return res.status(500).json({ error: err.message });
      }
      next(err);
    }
  });

  return router;
}

export default createSep0001Router();
