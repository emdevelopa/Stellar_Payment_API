import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getKycData,
  getKycStatus,
  storeKycData,
  storeKycVerification,
  acquireKycVerificationLock,
  releaseKycVerificationLock,
  invalidateKycCaches,
  getKycStatistics,
} from "../src/lib/sep12-kyc.js";

// Mock Redis client
const createMockRedisClient = () => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
  del: vi.fn().mockResolvedValue(1),
  hGetAll: vi.fn().mockResolvedValue({}),
  expire: vi.fn().mockResolvedValue(1),
});

// Mock Supabase
vi.mock("../src/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { supabase } from "../src/lib/supabase.js";

describe("SEP-12 KYC Integration E2E Tests", () => {
  let mockRedis;
  const testAccountId = "GBRPYHIL2CI3WHZKYYXY5UYSZES3IQNB54GQMVWHTFXNAXN3C5GKQCVX";

  beforeEach(() => {
    mockRedis = createMockRedisClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("KYC Data Retrieval and Caching", () => {
    it("should retrieve KYC data from cache when available", async () => {
      const cachedData = {
        account_id: testAccountId,
        first_name: "John",
        last_name: "Doe",
        email: "john@example.com",
      };

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await getKycData(testAccountId, mockRedis);

      expect(result).toEqual(cachedData);
      expect(mockRedis.get).toHaveBeenCalledWith(`kyc:${testAccountId}`);
    });

    it("should fetch KYC data from database and cache it", async () => {
      const dbData = {
        account_id: testAccountId,
        first_name: "Jane",
        last_name: "Smith",
        email: "jane@example.com",
        created_at: new Date().toISOString(),
      };

      mockRedis.get.mockResolvedValueOnce(null);
      supabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          eq: vi.fn().mockReturnValueOnce({
            maybeSingle: vi.fn().mockResolvedValueOnce({
              data: dbData,
              error: null,
            }),
          }),
        }),
      });

      const result = await getKycData(testAccountId, mockRedis);

      expect(result).toEqual(dbData);
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it("should return null when KYC data not found", async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      supabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          eq: vi.fn().mockReturnValueOnce({
            maybeSingle: vi.fn().mockResolvedValueOnce({
              data: null,
              error: null,
            }),
          }),
        }),
      });

      const result = await getKycData(testAccountId, mockRedis);

      expect(result).toBeNull();
    });

    it("should throw error when account ID is not provided", async () => {
      await expect(getKycData(null, mockRedis)).rejects.toThrow(
        "Account ID is required",
      );
    });
  });

  describe("KYC Status Management", () => {
    it("should retrieve KYC verification status from cache", async () => {
      const statusData = {
        account_id: testAccountId,
        status: "verified",
        verified_at: new Date().toISOString(),
      };

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(statusData));

      const result = await getKycStatus(testAccountId, mockRedis);

      expect(result).toEqual(statusData);
      expect(mockRedis.get).toHaveBeenCalledWith(`kyc:status:${testAccountId}`);
    });

    it("should fetch KYC status from database and cache it", async () => {
      const statusData = {
        account_id: testAccountId,
        status: "pending",
        created_at: new Date().toISOString(),
      };

      mockRedis.get.mockResolvedValueOnce(null);
      supabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          eq: vi.fn().mockReturnValueOnce({
            order: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockReturnValueOnce({
                maybeSingle: vi.fn().mockResolvedValueOnce({
                  data: statusData,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      const result = await getKycStatus(testAccountId, mockRedis);

      expect(result).toEqual(statusData);
      expect(mockRedis.set).toHaveBeenCalled();
    });
  });

  describe("KYC Data Storage", () => {
    it("should store KYC data and invalidate cache", async () => {
      const kycData = {
        first_name: "John",
        last_name: "Doe",
        document_type: "passport",
        document_id: "A12345678",
      };

      supabase.from.mockReturnValueOnce({
        upsert: vi.fn().mockReturnValueOnce({
          select: vi.fn().mockReturnValueOnce({
            single: vi.fn().mockResolvedValueOnce({
              data: {
                account_id: testAccountId,
                ...kycData,
                updated_at: new Date().toISOString(),
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await storeKycData(testAccountId, kycData, mockRedis);

      expect(result).toBeDefined();
      expect(result.account_id).toBe(testAccountId);
      expect(mockRedis.del).toHaveBeenCalledWith(`kyc:${testAccountId}`);
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it("should throw error when storing without required parameters", async () => {
      await expect(storeKycData(null, {}, mockRedis)).rejects.toThrow(
        "Account ID and KYC data are required",
      );
    });
  });

  describe("KYC Verification Locking", () => {
    it("should acquire verification lock", async () => {
      mockRedis.set.mockResolvedValueOnce("OK");

      const acquired = await acquireKycVerificationLock(testAccountId, mockRedis);

      expect(acquired).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        `kyc:lock:${testAccountId}`,
        "1",
        expect.objectContaining({
          NX: true,
          EX: 60,
        }),
      );
    });

    it("should fail to acquire lock if already locked", async () => {
      mockRedis.set.mockResolvedValueOnce(null);

      const acquired = await acquireKycVerificationLock(testAccountId, mockRedis);

      expect(acquired).toBe(false);
    });

    it("should release verification lock", async () => {
      mockRedis.del.mockResolvedValueOnce(1);

      const released = await releaseKycVerificationLock(testAccountId, mockRedis);

      expect(released).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith(`kyc:lock:${testAccountId}`);
    });

    it("should prevent concurrent verifications using locks", async () => {
      mockRedis.set
        .mockResolvedValueOnce("OK") // First lock
        .mockResolvedValueOnce(null); // Second lock fails

      const lock1 = await acquireKycVerificationLock(testAccountId, mockRedis);
      const lock2 = await acquireKycVerificationLock(testAccountId, mockRedis);

      expect(lock1).toBe(true);
      expect(lock2).toBe(false);
    });
  });

  describe("KYC Cache Invalidation", () => {
    it("should invalidate all KYC-related caches", async () => {
      mockRedis.del.mockResolvedValue(1);

      await invalidateKycCaches(testAccountId, mockRedis);

      expect(mockRedis.del).toHaveBeenCalledTimes(2);
      expect(mockRedis.del).toHaveBeenCalledWith(`kyc:${testAccountId}`);
      expect(mockRedis.del).toHaveBeenCalledWith(`kyc:status:${testAccountId}`);
    });
  });

  describe("KYC Verification Storage", () => {
    it("should store verification result and update cache", async () => {
      const verificationData = {
        status: "verified",
        verified_by: "admin",
        verification_method: "manual",
      };

      supabase.from.mockReturnValueOnce({
        insert: vi.fn().mockReturnValueOnce({
          select: vi.fn().mockReturnValueOnce({
            single: vi.fn().mockResolvedValueOnce({
              data: {
                account_id: testAccountId,
                ...verificationData,
                created_at: new Date().toISOString(),
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await storeKycVerification(
        testAccountId,
        verificationData,
        mockRedis,
      );

      expect(result).toBeDefined();
      expect(result.status).toBe("verified");
      expect(mockRedis.del).toHaveBeenCalledWith(`kyc:status:${testAccountId}`);
    });
  });

  describe("KYC Statistics", () => {
    it("should retrieve cached KYC statistics", async () => {
      const stats = {
        total_accounts: 1000,
        verified_accounts: 750,
        pending_accounts: 250,
        verification_rate: 75.0,
      };

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(stats));

      const result = await getKycStatistics(mockRedis);

      expect(result).toEqual(stats);
      expect(mockRedis.get).toHaveBeenCalledWith("kyc:statistics");
    });

    it("should fetch statistics from database when not cached", async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      supabase.from
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValueOnce({
            count: "exact",
            head: true,
          }),
        })
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValueOnce({
            eq: vi.fn().mockReturnValueOnce({
              count: "exact",
              head: true,
            }),
          }),
        })
        .mockReturnValueOnce({
          select: vi.fn().mockReturnValueOnce({
            eq: vi.fn().mockReturnValueOnce({
              count: "exact",
              head: true,
            }),
          }),
        });

      const result = await getKycStatistics(mockRedis);

      expect(result).toBeDefined();
      expect(result).toHaveProperty("total_accounts");
      expect(result).toHaveProperty("verified_accounts");
      expect(result).toHaveProperty("pending_accounts");
      expect(result).toHaveProperty("verification_rate");
    });
  });

  describe("Cache Resilience", () => {
    it("should continue working when Redis is unavailable during get", async () => {
      mockRedis.get.mockRejectedValueOnce(new Error("Redis connection failed"));

      const dbData = {
        account_id: testAccountId,
        first_name: "Test",
      };

      supabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          eq: vi.fn().mockReturnValueOnce({
            maybeSingle: vi.fn().mockResolvedValueOnce({
              data: dbData,
              error: null,
            }),
          }),
        }),
      });

      const result = await getKycData(testAccountId, mockRedis);

      expect(result).toEqual(dbData);
    });

    it("should continue working when Redis is unavailable during set", async () => {
      const kycData = { first_name: "Test" };

      mockRedis.set.mockRejectedValueOnce(new Error("Redis connection failed"));

      supabase.from.mockReturnValueOnce({
        upsert: vi.fn().mockReturnValueOnce({
          select: vi.fn().mockReturnValueOnce({
            single: vi.fn().mockResolvedValueOnce({
              data: {
                account_id: testAccountId,
                ...kycData,
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await storeKycData(testAccountId, kycData, mockRedis);

      expect(result).toBeDefined();
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle concurrent reads with cache hits", async () => {
      const cachedData = {
        account_id: testAccountId,
        first_name: "John",
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));

      const results = await Promise.all([
        getKycData(testAccountId, mockRedis),
        getKycData(testAccountId, mockRedis),
        getKycData(testAccountId, mockRedis),
      ]);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.account_id === testAccountId)).toBe(true);
      expect(mockRedis.get).toHaveBeenCalledTimes(3);
    });

    it("should prevent concurrent verification attempts", async () => {
      mockRedis.set
        .mockResolvedValueOnce("OK")
        .mockResolvedValueOnce("OK")
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const locks = await Promise.all([
        acquireKycVerificationLock(testAccountId, mockRedis),
        acquireKycVerificationLock(testAccountId, mockRedis),
      ]);

      expect(locks.filter((l) => l === true)).toHaveLength(1);
      expect(locks.filter((l) => l === false)).toHaveLength(1);
    });
  });
});
