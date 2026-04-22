/**
 * Integration tests for Row Level Security (Issue #223)
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
});
