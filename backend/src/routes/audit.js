/**
 * Audit Logs Routes
 * Issue #155: Merchant Profile Change Audit Logs
 */

import express from "express";
import { auditService } from "../services/auditService.js";
import { requireApiKeyAuth } from "../lib/auth.js";
import { generatePaginationLinks } from "../lib/pagination-links.js";

const router = express.Router();

/**
 * @swagger
 * /api/audit-logs:
 *   get:
 *     summary: Get audit logs for the authenticated merchant
 *     tags: [Audit]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number (1-indexed)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of results per page (max 100)
 *     responses:
 *       200:
 *         description: Paginated audit logs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total_count:
 *                   type: integer
 *                 total_pages:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 links:
 *                   type: object
 *                   properties:
 *                     next:
 *                       type: string
 *                       description: URL to the next page
 *                     previous:
 *                       type: string
 *                       description: URL to the previous page
 *       401:
 *         description: Missing or invalid API key
 */
router.get("/audit-logs", requireApiKeyAuth(), async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await auditService.getAuditLogs(req.merchant.id, page, limit);
    res.json({
      ...result,
      ...generatePaginationLinks(req, result.page, result.limit, result.total_pages),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
