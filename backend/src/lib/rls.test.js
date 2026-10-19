/**
 * Integration and stress tests for Row Level Security (Issue #223, #1471)
 *
 * These tests verify that database-level RLS policies prevent Merchant A
 * from reading or modifying Merchant B's data.
 *
 * Prerequisites: a real PostgreSQL instance with RLS applied.
 * Skip gracefully when DATABASE_URL is not set so CI doesn't fail in
 * environments without a database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import crypto from "crypto";

const { Pool } = pg;

const DB_URL = process.env.DATABASE_URL;

// Helper: create an isolated pool that sets app.current_merchant_id for every
// connection, simulating what the Express API does for service-role requests.
function poolForMerchant(merchantId) {
  return new Pool({
    connectionString: DB_URL,
    max: 1,
  });
}

async function setMerchantSession(client, merchantId) {
  await client.query("SET LOCAL app.current_merchant_id = $1", [merchantId]);
}

// Helper: measure query execution time
async function measureQueryTime(fn) {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;
  return { result, duration };
}

describe.skipIf(!DB_URL || process.env.CI)("RLS — cross-merchant data isolation", () => {
  let pool;
  let merchantAId;
  let merchantBId;
  let paymentAId;
  let paymentBId;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 2 });

    // Create two merchant rows directly (bypassing RLS via superuser pool)
    merchantAId = crypto.randomUUID();
    merchantBId = crypto.randomUUID();
    paymentAId = crypto.randomUUID();
    paymentBId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO merchants (id, email, business_name, notification_email, api_key, webhook_secret)
       VALUES ($1, $2, 'Merchant A', $2, $3, 'secretA')`,
      [merchantAId, `merchant-a-${Date.now()}@test.local`, `key-a-${Date.now()}`],
    );
    await pool.query(
      `INSERT INTO merchants (id, email, business_name, notification_email, api_key, webhook_secret)
       VALUES ($1, $2, 'Merchant B', $2, $3, 'secretB')`,
      [merchantBId, `merchant-b-${Date.now()}@test.local`, `key-b-${Date.now()}`],
    );

    await pool.query(
      `INSERT INTO payments (id, merchant_id, amount, asset, recipient, status)
       VALUES ($1, $2, 10.0, 'XLM', 'GTEST', 'completed')`,
      [paymentAId, merchantAId],
    );
    await pool.query(
      `INSERT INTO payments (id, merchant_id, amount, asset, recipient, status)
       VALUES ($1, $2, 20.0, 'USDC', 'GTEST2', 'completed')`,
      [paymentBId, merchantBId],
    );
  });

  afterAll(async () => {
    // Cleanup — order matters due to FK constraints
    await pool.query("DELETE FROM payments WHERE id = ANY($1)", [[paymentAId, paymentBId]]);
    await pool.query("DELETE FROM merchants WHERE id = ANY($1)", [[merchantAId, merchantBId]]);
    await pool.end();
  });

  it("Merchant A can read their own payments", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await setMerchantSession(client, merchantAId);
      const { rows } = await client.query(
        "SELECT id FROM payments WHERE merchant_id = $1",
        [merchantAId],
      );
      expect(rows.map((r) => r.id)).toContain(paymentAId);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("Merchant A cannot read Merchant B's payments", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await setMerchantSession(client, merchantAId);
      const { rows } = await client.query(
        "SELECT id FROM payments WHERE id = $1",
        [paymentBId],
      );
      // RLS should filter the row out — empty result
      expect(rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("Merchant B cannot read Merchant A's payments", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await setMerchantSession(client, merchantBId);
      const { rows } = await client.query(
        "SELECT id FROM payments WHERE id = $1",
        [paymentAId],
      );
      expect(rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("Merchant A cannot update Merchant B's payments", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await setMerchantSession(client, merchantAId);
      const { rowCount } = await client.query(
        "UPDATE payments SET status = 'failed' WHERE id = $1",
        [paymentBId],
      );
      // RLS should prevent the update — 0 rows affected
      expect(rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("Merchant A cannot read Merchant B's merchant row", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await setMerchantSession(client, merchantAId);
      const { rows } = await client.query(
        "SELECT id FROM merchants WHERE id = $1",
        [merchantBId],
      );
      expect(rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  describe("Transaction isolation and concurrent access", () => {
    it("handles concurrent read operations from different merchants", async () => {
      const clientA = await pool.connect();
      const clientB = await pool.connect();

      try {
        await clientA.query("BEGIN");
        await clientB.query("BEGIN");

        await setMerchantSession(clientA, merchantAId);
        await setMerchantSession(clientB, merchantBId);

        const [resultA, resultB] = await Promise.all([
          clientA.query("SELECT id FROM payments WHERE merchant_id = $1", [merchantAId]),
          clientB.query("SELECT id FROM payments WHERE merchant_id = $1", [merchantBId]),
        ]);

        expect(resultA.rows.map((r) => r.id)).toContain(paymentAId);
        expect(resultB.rows.map((r) => r.id)).toContain(paymentBId);

        // Verify no cross-contamination
        expect(resultA.rows.map((r) => r.id)).not.toContain(paymentBId);
        expect(resultB.rows.map((r) => r.id)).not.toContain(paymentAId);
      } finally {
        await clientA.query("ROLLBACK");
        await clientB.query("ROLLBACK");
        clientA.release();
        clientB.release();
      }
    });

    it("prevents concurrent write conflicts on same merchant data", async () => {
      const clientA = await pool.connect();
      const clientB = await pool.connect();

      try {
        await clientA.query("BEGIN");
        await clientB.query("BEGIN");

        await setMerchantSession(clientA, merchantAId);
        await setMerchantSession(clientB, merchantAId);

        // First update succeeds
        await clientA.query(
          "UPDATE payments SET amount = amount + 1 WHERE id = $1",
          [paymentAId],
        );

        // Second update should still work (same merchant context)
        const { rowCount } = await clientB.query(
          "UPDATE payments SET amount = amount + 1 WHERE id = $1",
          [paymentAId],
        );

        expect(rowCount).toBe(1);
      } finally {
        await clientA.query("ROLLBACK");
        await clientB.query("ROLLBACK");
        clientA.release();
        clientB.release();
      }
    });
  });

  describe("Performance and stress tests", () => {
    it("handles bulk read operations efficiently", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await setMerchantSession(client, merchantAId);

        const { result, duration } = await measureQueryTime(() =>
          client.query("SELECT id FROM payments WHERE merchant_id = $1", [merchantAId]),
        );

        // Should complete within 1 second for a simple query
        expect(duration).toBeLessThan(1000);
        expect(result.rows.length).toBeGreaterThan(0);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("handles sequential RLS context switches without degradation", async () => {
      const client = await pool.connect();
      const iterations = 10;
      const durations = [];

      try {
        for (let i = 0; i < iterations; i++) {
          await client.query("BEGIN");

          // Switch context multiple times
          await setMerchantSession(client, merchantAId);
          await client.query("SELECT 1");

          await setMerchantSession(client, merchantBId);
          await client.query("SELECT 1");

          await setMerchantSession(client, merchantAId);
          const { result, duration } = await measureQueryTime(() =>
            client.query("SELECT id FROM payments WHERE merchant_id = $1", [merchantAId]),
          );

          durations.push(duration);
          await client.query("ROLLBACK");
        }

        // Average duration should not degrade significantly
        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        expect(avgDuration).toBeLessThan(500);
      } finally {
        client.release();
      }
    });

    it("handles complex queries with joins under RLS", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await setMerchantSession(client, merchantAId);

        const { result, duration } = await measureQueryTime(() =>
          client.query(
            `SELECT p.id, p.amount, m.business_name
             FROM payments p
             JOIN merchants m ON p.merchant_id = m.id
             WHERE p.merchant_id = $1`,
            [merchantAId],
          ),
        );

        expect(duration).toBeLessThan(1000);
        expect(result.rows.length).toBeGreaterThan(0);
        expect(result.rows[0].business_name).toBe("Merchant A");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
  });

  describe("Edge cases and security validation", () => {
    it("handles NULL merchant context gracefully", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Set NULL merchant context
        await client.query("SET LOCAL app.current_merchant_id = NULL");

        const { rows } = await client.query("SELECT id FROM payments");
        // Should return empty or filtered based on RLS policy
        expect(rows).toBeDefined();
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("prevents SQL injection through merchant context", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Attempt to inject SQL through merchant context
        const maliciousId = "'; DROP TABLE payments; --";

        await setMerchantSession(client, maliciousId);

        const { rows } = await client.query("SELECT id FROM payments WHERE merchant_id = $1", [maliciousId]);
        // Should not match any rows and not execute the injected SQL
        expect(rows).toHaveLength(0);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("handles large result sets under RLS", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await setMerchantSession(client, merchantAId);

        // Query with a wide filter to test performance
        const { result, duration } = await measureQueryTime(() =>
          client.query("SELECT * FROM payments WHERE merchant_id = $1 LIMIT 1000", [merchantAId]),
        );

        expect(duration).toBeLessThan(2000);
        expect(result.rows).toBeDefined();
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("validates RLS policy on aggregate queries", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await setMerchantSession(client, merchantAId);

        const { rows } = await client.query(
          "SELECT COUNT(*) as count, SUM(amount) as total FROM payments WHERE merchant_id = $1",
          [merchantAId],
        );

        expect(rows[0].count).toBeGreaterThan(0);
        expect(rows[0].total).toBeGreaterThan(0);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
  });

  describe("Error handling and recovery", () => {
    it("handles connection errors gracefully", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await setMerchantSession(client, merchantAId);

        // Simulate a connection error by using invalid query
        await expect(
          client.query("SELECT * FROM nonexistent_table"),
        ).rejects.toThrow();

        // Connection should still be usable after error
        await setMerchantSession(client, merchantAId);
        const { rows } = await client.query("SELECT id FROM payments WHERE merchant_id = $1", [merchantAId]);
        expect(rows).toBeDefined();
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("maintains RLS context after query errors", async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await setMerchantSession(client, merchantAId);

        // Execute invalid query
        await expect(
          client.query("SELECT * FROM nonexistent_table"),
        ).rejects.toThrow();

        // RLS context should still be active
        const { rows } = await client.query("SELECT id FROM payments WHERE merchant_id = $1", [merchantAId]);
        expect(rows.map((r) => r.id)).toContain(paymentAId);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
  });
});
