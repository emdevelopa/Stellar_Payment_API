/**
 * Audit Logs Routes
 * Issue #155: Merchant Profile Change Audit Logs
 */

import express from "express";
import { auditService } from "../services/auditService.js";
import { requireApiKeyAuth } from "../lib/auth.js";
import { generatePaginationLinks } from "../lib/pagination-links.js";
import {
  consumeAuditLogRateLimit,
  createAuditLogRateLimitKey,
} from "../lib/audit-security.js";
import { auditLogReadRequestsTotal, auditLogRateLimitRejectionsTotal } from "../lib/metrics.js";

const router = express.Router();

// Per-merchant rate limit for audit log reads (issue #768).
// Prevents a single merchant from generating excessive DB load via this endpoint.
const AUDIT_READ_RATE_LIMIT_MAX = Number(process.env.AUDIT_READ_RATE_LIMIT_MAX || 30);
const AUDIT_READ_RATE_LIMIT_WINDOW_MS = Number(
  process.env.AUDIT_READ_RATE_LIMIT_WINDOW_MS || 60_000,
);

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
 *       429:
 *         description: Rate limit exceeded
 */
router.get("/audit-logs", requireApiKeyAuth(), async (req, res, next) => {
  try {
    const rateLimitKey = createAuditLogRateLimitKey({
      merchantId: req.merchant.id,
      action: "audit-read",
      ipAddress: req.ip,
    });
    const rateLimitResult = consumeAuditLogRateLimit(rateLimitKey, {
      max: AUDIT_READ_RATE_LIMIT_MAX,
      windowMs: AUDIT_READ_RATE_LIMIT_WINDOW_MS,
    });
    if (!rateLimitResult.allowed) {
      auditLogRateLimitRejectionsTotal.inc({ source: "read" });
      auditLogReadRequestsTotal.inc({ result: "rate_limited" });
      return res.status(429).json({
        error: "Too many requests",
        code: "AUDIT_READ_RATE_LIMITED",
      });
    }

    const { page, limit } = req.query;
    const result = await auditService.getAuditLogs(req.merchant.id, page, limit);
    auditLogReadRequestsTotal.inc({ result: "success" });
    res.json({
      ...result,
      ...generatePaginationLinks(req, result.page, result.limit, result.total_pages),
    });
  } catch (err) {
    auditLogReadRequestsTotal.inc({ result: "error" });
    next(err);
  }
});

export default router;
