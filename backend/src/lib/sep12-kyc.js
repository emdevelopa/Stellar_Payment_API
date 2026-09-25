import { getRedisClient } from "./redis.js";
import { supabase } from "./supabase.js";

const KYC_CACHE_TTL = 3600; // 1 hour
const KYC_STATUS_CACHE_TTL = 300; // 5 minutes
const KYC_VERIFICATION_LOCK_TTL = 60; // 1 minute

function getKycCacheKey(accountId) {
  return `kyc:${accountId}`;
}

function getKycStatusCacheKey(accountId) {
  return `kyc:status:${accountId}`;
}

function getKycVerificationLockKey(accountId) {
  return `kyc:lock:${accountId}`;
}

/**
 * Retrieve KYC data from cache or database
 * @param {string} accountId - Stellar account ID or merchant ID
 * @param {object} redisClient - Redis client instance
 * @returns {Promise<object|null>} KYC data or null if not found
 */
export async function getKycData(accountId, redisClient = null) {
  if (!accountId) {
    throw new Error("Account ID is required");
  }

  const client = redisClient || getRedisClient();
  const cacheKey = getKycCacheKey(accountId);

  try {
    // Try to get from cache
    const cached = await client.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.error("Redis GET error:", err.message);
  }

  try {
    // Fall back to database
    const { data, error } = await supabase
      .from("kyc_data")
      .select("*")
      .eq("account_id", accountId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      // Cache the result
      try {
        await client.set(cacheKey, JSON.stringify(data), {
          EX: KYC_CACHE_TTL,
        });
      } catch (err) {
        console.error("Redis SET error:", err.message);
      }
    }

    return data || null;
  } catch (err) {
    console.error("Database error:", err.message);
    return null;
  }
}

/**
 * Retrieve KYC verification status from cache or database
 * @param {string} accountId - Stellar account ID or merchant ID
 * @param {object} redisClient - Redis client instance
 * @returns {Promise<object|null>} KYC status or null if not found
 */
export async function getKycStatus(accountId, redisClient = null) {
  if (!accountId) {
    throw new Error("Account ID is required");
  }

  const client = redisClient || getRedisClient();
  const cacheKey = getKycStatusCacheKey(accountId);

  try {
    // Try to get from cache
    const cached = await client.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.error("Redis GET error:", err.message);
  }

  try {
    // Fall back to database
    const { data, error } = await supabase
      .from("kyc_verification")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      // Cache the result
      try {
        await client.set(cacheKey, JSON.stringify(data), {
          EX: KYC_STATUS_CACHE_TTL,
        });
      } catch (err) {
        console.error("Redis SET error:", err.message);
      }
    }

    return data || null;
  } catch (err) {
    console.error("Database error:", err.message);
    return null;
  }
}

/**
 * Store or update KYC data with cache invalidation
 * @param {string} accountId - Stellar account ID or merchant ID
 * @param {object} kycData - KYC data to store
 * @param {object} redisClient - Redis client instance
 * @returns {Promise<object|null>} Stored KYC data or null on error
 */
export async function storeKycData(accountId, kycData, redisClient = null) {
  if (!accountId || !kycData) {
    throw new Error("Account ID and KYC data are required");
  }

  const client = redisClient || getRedisClient();

  try {
    const { data, error } = await supabase
      .from("kyc_data")
      .upsert({
        account_id: accountId,
        ...kycData,
        updated_at: new Date().toISOString(),
      }, { onConflict: "account_id" })
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Invalidate cache
    try {
      await client.del(getKycCacheKey(accountId));
    } catch (err) {
      console.error("Redis DEL error:", err.message);
    }

    // Set fresh cache
    try {
      await client.set(getKycCacheKey(accountId), JSON.stringify(data), {
        EX: KYC_CACHE_TTL,
      });
    } catch (err) {
      console.error("Redis SET error:", err.message);
    }

    return data;
  } catch (err) {
    console.error("Database error:", err.message);
    return null;
  }
}

/**
 * Store KYC verification result with cache invalidation
 * @param {string} accountId - Stellar account ID or merchant ID
 * @param {object} verificationData - Verification result data
 * @param {object} redisClient - Redis client instance
 * @returns {Promise<object|null>} Stored verification data or null on error
 */
export async function storeKycVerification(accountId, verificationData, redisClient = null) {
  if (!accountId || !verificationData) {
    throw new Error("Account ID and verification data are required");
  }

  const client = redisClient || getRedisClient();

  try {
    const { data, error } = await supabase
      .from("kyc_verification")
      .insert({
        account_id: accountId,
        ...verificationData,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Invalidate status cache
    try {
      await client.del(getKycStatusCacheKey(accountId));
    } catch (err) {
      console.error("Redis DEL error:", err.message);
    }

    // Set fresh cache
    try {
      await client.set(getKycStatusCacheKey(accountId), JSON.stringify(data), {
        EX: KYC_STATUS_CACHE_TTL,
      });
    } catch (err) {
      console.error("Redis SET error:", err.message);
    }

    return data;
  } catch (err) {
    console.error("Database error:", err.message);
    return null;
  }
}

/**
 * Acquire a verification lock to prevent concurrent verifications
 * @param {string} accountId - Stellar account ID or merchant ID
 * @param {object} redisClient - Redis client instance
 * @returns {Promise<boolean>} True if lock acquired, false otherwise
 */
export async function acquireKycVerificationLock(accountId, redisClient = null) {
  if (!accountId) {
    throw new Error("Account ID is required");
  }

  const client = redisClient || getRedisClient();
  const lockKey = getKycVerificationLockKey(accountId);

  try {
    const result = await client.set(lockKey, "1", {
      NX: true,
      EX: KYC_VERIFICATION_LOCK_TTL,
    });
    return !!result;
  } catch (err) {
    console.error("Redis SET error:", err.message);
    return false;
  }
}

/**
 * Release a verification lock
 * @param {string} accountId - Stellar account ID or merchant ID
 * @param {object} redisClient - Redis client instance
 * @returns {Promise<boolean>} True if lock released, false otherwise
 */
export async function releaseKycVerificationLock(accountId, redisClient = null) {
  if (!accountId) {
    throw new Error("Account ID is required");
  }

  const client = redisClient || getRedisClient();
  const lockKey = getKycVerificationLockKey(accountId);

  try {
    const result = await client.del(lockKey);
    return result > 0;
  } catch (err) {
    console.error("Redis DEL error:", err.message);
    return false;
  }
}

/**
 * Invalidate all KYC-related caches for an account
 * @param {string} accountId - Stellar account ID or merchant ID
 * @param {object} redisClient - Redis client instance
 * @returns {Promise<void>}
 */
export async function invalidateKycCaches(accountId, redisClient = null) {
  if (!accountId) {
    throw new Error("Account ID is required");
  }

  const client = redisClient || getRedisClient();

  try {
    await Promise.all([
      client.del(getKycCacheKey(accountId)),
      client.del(getKycStatusCacheKey(accountId)),
    ]);
  } catch (err) {
    console.error("Redis DEL error:", err.message);
  }
}

/**
 * Get cached KYC statistics
 * @param {object} redisClient - Redis client instance
 * @returns {Promise<object>} KYC statistics
 */
export async function getKycStatistics(redisClient = null) {
  const client = redisClient || getRedisClient();
  const cacheKey = "kyc:statistics";

  try {
    // Try to get from cache
    const cached = await client.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.error("Redis GET error:", err.message);
  }

  try {
    // Get statistics from database
    const { data: totalCount } = await supabase
      .from("kyc_data")
      .select("id", { count: "exact", head: true });

    const { data: verifiedCount } = await supabase
      .from("kyc_verification")
      .select("id", { count: "exact", head: true })
      .eq("status", "verified");

    const { data: pendingCount } = await supabase
      .from("kyc_verification")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    const stats = {
      total_accounts: totalCount?.length || 0,
      verified_accounts: verifiedCount?.length || 0,
      pending_accounts: pendingCount?.length || 0,
      verification_rate: totalCount?.length > 0
        ? ((verifiedCount?.length || 0) / totalCount.length) * 100
        : 0,
    };

    // Cache the result
    try {
      await client.set(cacheKey, JSON.stringify(stats), {
        EX: 300, // 5 minutes
      });
    } catch (err) {
      console.error("Redis SET error:", err.message);
    }

    return stats;
  } catch (err) {
    console.error("Database error:", err.message);
    return {
      total_accounts: 0,
      verified_accounts: 0,
      pending_accounts: 0,
      verification_rate: 0,
    };
  }
}
