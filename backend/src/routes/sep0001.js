import express from "express";
import { supabase } from "../lib/supabase.js";
import { generateStellarToml, validateStellarToml } from "../lib/sep0001-generator.js";

const router = express.Router();

/**
 * @swagger
 * /.well-known/stellar.toml:
 *   get:
 *     summary: Get SEP-0001 stellar.toml for merchant
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

    // Fetch merchant data
    const { data: merchant, error } = await supabase
      .from("merchants")
      .select("id, business_name, email, notification_email, recipient, branding_config")
      .eq("id", merchantId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      console.error("Failed to fetch merchant:", error);
      return res.status(500).json({ error: "Failed to fetch merchant" });
    }

    if (!merchant) {
      return res.status(404).json({ error: "Merchant not found" });
    }

    // Generate stellar.toml
    const tomlContent = generateStellarToml(merchant);

    // Validate generated content
    if (!validateStellarToml(tomlContent)) {
      console.error("Generated invalid stellar.toml for merchant:", merchantId);
      return res.status(500).json({ error: "Failed to generate valid stellar.toml" });
    }

    // Return as text/plain with proper caching headers
    res.set({
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600", // Cache for 1 hour
    });
    res.send(tomlContent);
  } catch (err) {
    console.error("Error generating stellar.toml:", err);
    next(err);
  }
});

export default router;
