import express from "express";
import { supabase } from "../lib/supabase.js";
import {
  getKycData,
  getKycStatus,
  storeKycData,
  storeKycVerification,
  acquireKycVerificationLock,
  releaseKycVerificationLock,
  invalidateKycCaches,
  getKycStatistics,
} from "../lib/sep12-kyc.js";
import { connectRedisClient } from "../lib/redis.js";
import { validateRequest } from "../lib/validation.js";

const router = express.Router();

/**
 * Get KYC data for an account
 * GET /api/sep12/kyc/:accountId
 */
router.get("/sep12/kyc/:accountId", async (req, res, next) => {
  try {
    const { accountId } = req.params;

    if (!accountId) {
      return res.status(400).json({ error: "Account ID is required" });
    }

    const redisClient = await connectRedisClient();
    const kycData = await getKycData(accountId, redisClient);

    if (!kycData) {
      return res.status(404).json({ error: "KYC data not found" });
    }

    res.json({
      account_id: kycData.account_id,
      first_name: kycData.first_name,
      last_name: kycData.last_name,
      email: kycData.email,
      phone_number: kycData.phone_number,
      date_of_birth: kycData.date_of_birth,
      nationality: kycData.nationality,
      status: kycData.status,
      created_at: kycData.created_at,
      updated_at: kycData.updated_at,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get KYC verification status for an account
 * GET /api/sep12/kyc/:accountId/status
 */
router.get("/sep12/kyc/:accountId/status", async (req, res, next) => {
  try {
    const { accountId } = req.params;

    if (!accountId) {
      return res.status(400).json({ error: "Account ID is required" });
    }

    const redisClient = await connectRedisClient();
    const status = await getKycStatus(accountId, redisClient);

    if (!status) {
      return res.status(404).json({
        account_id: accountId,
        status: "unverified",
        message: "No verification record found",
      });
    }

    res.json({
      account_id: status.account_id,
      status: status.status,
      verified_at: status.verified_at,
      verified_by: status.verified_by,
      verification_method: status.verification_method,
      created_at: status.created_at,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Submit KYC data for verification
 * POST /api/sep12/kyc
 */
router.post("/sep12/kyc", async (req, res, next) => {
  try {
    const { account_id, first_name, last_name, email, phone_number, date_of_birth, nationality } = req.body;

    if (!account_id || !first_name || !last_name || !email) {
      return res.status(400).json({
        error: "Missing required fields: account_id, first_name, last_name, email",
      });
    }

    const redisClient = await connectRedisClient();

    // Check if verification is already in progress
    const lockAcquired = await acquireKycVerificationLock(account_id, redisClient);

    if (!lockAcquired) {
      return res.status(409).json({
        error: "KYC verification already in progress for this account",
      });
    }

    try {
      const kycData = {
        first_name,
        last_name,
        email,
        phone_number: phone_number || null,
        date_of_birth: date_of_birth || null,
        nationality: nationality || null,
        status: "pending",
      };

      const storedData = await storeKycData(account_id, kycData, redisClient);

      if (!storedData) {
        return res.status(500).json({
          error: "Failed to store KYC data",
        });
      }

      // Store verification record
      await storeKycVerification(
        account_id,
        {
          status: "pending",
          verification_method: "manual",
        },
        redisClient,
      );

      res.status(201).json({
        message: "KYC data submitted successfully",
        account_id: storedData.account_id,
        status: "pending",
      });
    } finally {
      await releaseKycVerificationLock(account_id, redisClient);
    }
  } catch (err) {
    next(err);
  }
});

/**
 * Verify KYC data (admin only)
 * POST /api/sep12/kyc/:accountId/verify
 */
router.post("/sep12/kyc/:accountId/verify", async (req, res, next) => {
  try {
    const { accountId } = req.params;
    const { verified_by, verification_method, notes } = req.body;

    if (!accountId) {
      return res.status(400).json({ error: "Account ID is required" });
    }

    const redisClient = await connectRedisClient();

    // Acquire lock for verification
    const lockAcquired = await acquireKycVerificationLock(accountId, redisClient);

    if (!lockAcquired) {
      return res.status(409).json({
        error: "KYC verification already in progress for this account",
      });
    }

    try {
      const verificationData = {
        status: "verified",
        verified_by: verified_by || "system",
        verification_method: verification_method || "manual",
        notes: notes || null,
        verified_at: new Date().toISOString(),
      };

      const storedVerification = await storeKycVerification(
        accountId,
        verificationData,
        redisClient,
      );

      if (!storedVerification) {
        return res.status(500).json({
          error: "Failed to store verification result",
        });
      }

      // Update KYC data status
      const kycData = await getKycData(accountId, redisClient);
      if (kycData) {
        await storeKycData(
          accountId,
          { ...kycData, status: "verified" },
          redisClient,
        );
      }

      res.json({
        message: "KYC verification completed",
        account_id: accountId,
        status: "verified",
      });
    } finally {
      await releaseKycVerificationLock(accountId, redisClient);
    }
  } catch (err) {
    next(err);
  }
});

/**
 * Reject KYC data (admin only)
 * POST /api/sep12/kyc/:accountId/reject
 */
router.post("/sep12/kyc/:accountId/reject", async (req, res, next) => {
  try {
    const { accountId } = req.params;
    const { reason, rejected_by } = req.body;

    if (!accountId) {
      return res.status(400).json({ error: "Account ID is required" });
    }

    if (!reason) {
      return res.status(400).json({ error: "Rejection reason is required" });
    }

    const redisClient = await connectRedisClient();

    const verificationData = {
      status: "rejected",
      rejected_by: rejected_by || "system",
      rejection_reason: reason,
      rejected_at: new Date().toISOString(),
    };

    const storedVerification = await storeKycVerification(
      accountId,
      verificationData,
      redisClient,
    );

    if (!storedVerification) {
      return res.status(500).json({
        error: "Failed to store rejection result",
      });
    }

    // Update KYC data status
    const kycData = await getKycData(accountId, redisClient);
    if (kycData) {
      await storeKycData(
        accountId,
        { ...kycData, status: "rejected" },
        redisClient,
      );
    }

    res.json({
      message: "KYC verification rejected",
      account_id: accountId,
      status: "rejected",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get KYC statistics
 * GET /api/sep12/statistics
 */
router.get("/sep12/statistics", async (req, res, next) => {
  try {
    const redisClient = await connectRedisClient();
    const stats = await getKycStatistics(redisClient);

    res.json(stats);
  } catch (err) {
    next(err);
  }
});

/**
 * Invalidate KYC cache for an account (admin only)
 * DELETE /api/sep12/kyc/:accountId/cache
 */
router.delete("/sep12/kyc/:accountId/cache", async (req, res, next) => {
  try {
    const { accountId } = req.params;

    if (!accountId) {
      return res.status(400).json({ error: "Account ID is required" });
    }

    const redisClient = await connectRedisClient();
    await invalidateKycCaches(accountId, redisClient);

    res.json({
      message: "KYC cache invalidated",
      account_id: accountId,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
