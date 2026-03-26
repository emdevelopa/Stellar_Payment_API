/**
 * Audit Logs Routes
 * Issue #155: Merchant Profile Change Audit Logs
 */

import express from "express";
import { pool } from "../lib/db.js";

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
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Results per page (max 100)
 *     responses:
 *       200:
 *         description: Audit log entries
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
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 */
router.get("/audit-logs", async (req, res, next) => {
  try {
    let page = parseInt(req.query.page, 10) || 1;
    let limit = parseInt(req.query.limit, 10) || 50;

    if (page < 1) page = 1;
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;

    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM audit_logs WHERE merchant_id = $1",
      [req.merchant.id],
    );
    const totalCount = parseInt(countResult.rows[0].count, 10);

    // Get paginated logs
    const logsResult = await pool.query(
      `SELECT id, action, field_changed, old_value, new_value, ip_address, user_agent, timestamp
       FROM audit_logs
       WHERE merchant_id = $1
       ORDER BY timestamp DESC
       LIMIT $2 OFFSET $3`,
      [req.merchant.id, limit, offset],
    );

    res.json({
      logs: logsResult.rows,
      total_count: totalCount,
      total_pages: Math.ceil(totalCount / limit),
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Middleware to log audit events with IP and user agent
 * Call this after merchant profile updates
 */
export async function logAuditEvent({
  merchantId,
  action,
  fieldChanged,
  oldValue,
  newValue,
  ipAddress,
  userAgent,
}) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (merchant_id, action, field_changed, old_value, new_value, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        merchantId,
        action,
        fieldChanged,
        oldValue,
        newValue,
        ipAddress,
        userAgent,
      ],
    );
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }
}

export default router;
