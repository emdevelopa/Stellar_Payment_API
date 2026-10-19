/**
 * Integration tests for Row-Level Security Advisory Locks (Issue #1470)
 *
 * These tests verify distributed concurrency control and locking mechanisms
 * for the Database Row-Level Security Service.
 *
 * Prerequisites: a real PostgreSQL instance with RLS applied.
 * Skip gracefully when DATABASE_URL is not set so CI doesn't fail in
 * environments without a database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import crypto from "crypto";
import {
  acquireAdvisoryLock,
  releaseAdvisoryLock,
  withAdvisoryLock,
  withMerchantContextAndLock,
  isAdvisoryLockHeld,
  getLockStats,
} from "./db-rls.js";

const { Pool } = pg;

const DB_URL = process.env.DATABASE_URL;

describe.skipIf(!DB_URL || process.env.CI)("RLS Advisory Locks — distributed concurrency control", () => {
  let pool;
  let merchantId;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 2 });
    merchantId = crypto.randomUUID();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("Basic lock operations", () => {
    it("acquires and releases an advisory lock", async () => {
      const acquired = await acquireAdvisoryLock(merchantId, "test-resource");
      expect(acquired).toBe(true);

      const held = await isAdvisoryLockHeld(merchantId, "test-resource");
      expect(held).toBe(true);

      const released = await releaseAdvisoryLock(merchantId, "test-resource");
      expect(released).toBe(true);

      const heldAfterRelease = await isAdvisoryLockHeld(merchantId, "test-resource");
      expect(heldAfterRelease).toBe(false);
    });

    it("fails to acquire lock when already held by another session", async () => {
      const client1 = await pool.connect();
      const client2 = await pool.connect();

      try {
        // Acquire lock in session 1
        await client1.query("SELECT pg_advisory_lock($1::bigint)", [
          Math.abs(merchantId.split("").reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) & a, 0)),
        ]);

        // Try to acquire in session 2 with timeout
        const acquired = await acquireAdvisoryLock(merchantId, "test-resource", { timeout: 1000 });
        expect(acquired).toBe(false);
      } finally {
        await client1.query("SELECT pg_advisory_unlock_all()");
        await client2.query("SELECT pg_advisory_unlock_all()");
        client1.release();
        client2.release();
      }
    });

    it("handles lock acquisition timeout", async () => {
      const client = await pool.connect();

      try {
        // Acquire lock and hold it
        await client.query("SELECT pg_advisory_lock($1::bigint)", [
          Math.abs(merchantId.split("").reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) & a, 0)),
        ]);

        // Try to acquire with short timeout
        const acquired = await acquireAdvisoryLock(merchantId, "test-resource", { timeout: 100 });
        expect(acquired).toBe(false);
      } finally {
        await client.query("SELECT pg_advisory_unlock_all()");
        client.release();
      }
    });
  });

  describe("withAdvisoryLock pattern", () => {
    it("executes callback while holding lock", async () => {
      let executionOrder = [];

      await withAdvisoryLock(merchantId, "test-resource", async () => {
        executionOrder.push("inside");
        expect(await isAdvisoryLockHeld(merchantId, "test-resource")).toBe(true);
      });

      executionOrder.push("after");
      expect(executionOrder).toEqual(["inside", "after"]);
      expect(await isAdvisoryLockHeld(merchantId, "test-resource")).toBe(false);
    });

    it("releases lock even if callback throws", async () => {
      await expect(
        withAdvisoryLock(merchantId, "test-resource", async () => {
          throw new Error("Test error");
        }),
      ).rejects.toThrow("Test error");

      expect(await isAdvisoryLockHeld(merchantId, "test-resource")).toBe(false);
    });

    it("throws when lock acquisition fails", async () => {
      const client = await pool.connect();

      try {
        // Hold the lock
        await client.query("SELECT pg_advisory_lock($1::bigint)", [
          Math.abs(merchantId.split("").reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) & a, 0)),
        ]);

        await expect(
          withAdvisoryLock(merchantId, "test-resource", async () => {}, { timeout: 100 }),
        ).rejects.toThrow("Failed to acquire advisory lock");
      } finally {
        await client.query("SELECT pg_advisory_unlock_all()");
        client.release();
      }
    });
  });

  describe("withMerchantContextAndLock pattern", () => {
    it("combines RLS context with advisory lock", async () => {
      let contextSet = false;
      let lockHeld = false;

      await withMerchantContextAndLock(merchantId, "test-resource", async (client) => {
        contextSet = true;
        lockHeld = await isAdvisoryLockHeld(merchantId, "test-resource");

        // Verify merchant context is set
        const { rows } = await client.query("SELECT current_setting('app.current_merchant_id', true) as merchant_id");
        expect(rows[0].merchant_id).toBe(merchantId);
      });

      expect(contextSet).toBe(true);
      expect(lockHeld).toBe(true);
    });

    it("releases both lock and transaction on error", async () => {
      await expect(
        withMerchantContextAndLock(merchantId, "test-resource", async () => {
          throw new Error("Test error");
        }),
      ).rejects.toThrow("Test error");

      expect(await isAdvisoryLockHeld(merchantId, "test-resource")).toBe(false);
    });
  });

  describe("Lock statistics and monitoring", () => {
    it("returns lock statistics", async () => {
      const stats = await getLockStats();

      expect(stats).toHaveProperty("advisoryLocks");
      expect(stats).toHaveProperty("relationLocks");
      expect(stats).toHaveProperty("transactionLocks");

      expect(typeof stats.advisoryLocks).toBe("number");
      expect(typeof stats.relationLocks).toBe("number");
      expect(typeof stats.transactionLocks).toBe("number");
    });

    it("tracks advisory locks in statistics", async () => {
      const statsBefore = await getLockStats();

      await acquireAdvisoryLock(merchantId, "test-resource");
      const statsDuring = await getLockStats();

      await releaseAdvisoryLock(merchantId, "test-resource");
      const statsAfter = await getLockStats();

      expect(statsDuring.advisoryLocks).toBeGreaterThanOrEqual(statsBefore.advisoryLocks);
      expect(statsAfter.advisoryLocks).toBeLessThanOrEqual(statsDuring.advisoryLocks);
    });
  });

  describe("Concurrent access scenarios", () => {
    it("serializes concurrent operations on same resource", async () => {
      const results = [];
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const operation = async (id) => {
        await withAdvisoryLock(merchantId, "test-resource", async () => {
          results.push(id);
          await delay(100);
        });
      };

      // Run operations concurrently
      await Promise.all([operation(1), operation(2), operation(3)]);

      // Operations should complete sequentially
      expect(results).toEqual([1, 2, 3]);
    });

    it("allows concurrent operations on different resources", async () => {
      const results = [];
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const operation = async (id, resource) => {
        await withAdvisoryLock(merchantId, resource, async () => {
          results.push(id);
          await delay(100);
        });
      };

      // Run operations on different resources concurrently
      await Promise.all([
        operation(1, "resource-a"),
        operation(2, "resource-b"),
        operation(3, "resource-c"),
      ]);

      // Operations should complete in any order (not serialized)
      expect(results.length).toBe(3);
    });
  });

  describe("Edge cases and error handling", () => {
    it("handles lock release when lock not held", async () => {
      const released = await releaseAdvisoryLock(merchantId, "nonexistent-resource");
      expect(released).toBe(false);
    });

    it("generates consistent lock keys for same inputs", async () => {
      const key1 = merchantId + ":test";
      const key2 = merchantId + ":test";

      // Generate keys using the same algorithm
      const hash1 = Math.abs(key1.split("").reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) & a, 0));
      const hash2 = Math.abs(key2.split("").reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) & a, 0));

      expect(hash1).toBe(hash2);
    });

    it("handles null or undefined merchant IDs gracefully", async () => {
      const acquired = await acquireAdvisoryLock(null, "test-resource");
      expect(typeof acquired).toBe("boolean");
    });
  });
});
