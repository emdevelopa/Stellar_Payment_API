import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pool } from "../src/lib/db.js";
import { archiveOldPaymentIntents } from "../src/lib/maintenance.js";

describe.skipIf(!process.env.DATABASE_URL || process.env.CI)("archiveOldPaymentIntents", () => {
  beforeEach(async () => {
    // Clear tables before each test
    await pool.query("DELETE FROM webhook_delivery_logs");
    await pool.query("DELETE FROM archived_payments");
    await pool.query("DELETE FROM payments");
    await pool.query("DELETE FROM merchants");

    // Insert a dummy merchant to satisfy foreign key constraints
    await pool.query(
      "INSERT INTO merchants (id, email, business_name, notification_email, api_key, webhook_secret) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        "11111111-1111-1111-1111-111111111111",
        "test@example.com",
        "Test Merchant",
        "notify@example.com",
        "test_api_key",
        "test_secret"
      ]
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("should move payments older than 90 days to archived_payments and delete them from payments", async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);

    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 10);

    // Insert test data
    await pool.query(
      "INSERT INTO payments (id, merchant_id, amount, asset, recipient, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7), ($8, $9, $10, $11, $12, $13, $14)",
      [
        "22222222-2222-2222-2222-222222222222", "11111111-1111-1111-1111-111111111111", 100.00, "XLM", "GB123", oldDate, oldDate,
        "33333333-3333-3333-3333-333333333333", "11111111-1111-1111-1111-111111111111", 50.00, "USDC", "GB123", recentDate, recentDate
      ]
    );

    const result = await archiveOldPaymentIntents();

    expect(result.archivedCount).toBe(1);

    // Verify payments table only has the recent payment
    const { rows: remainingPayments } = await pool.query("SELECT * FROM payments");
    expect(remainingPayments.length).toBe(1);
    expect(remainingPayments[0].id).toBe("33333333-3333-3333-3333-333333333333");

    // Verify archived_payments has the old payment
    const { rows: archivedPayments } = await pool.query("SELECT * FROM archived_payments");
    expect(archivedPayments.length).toBe(1);
    expect(archivedPayments[0].id).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("should do nothing if there are no old payments to archive", async () => {
    const result = await archiveOldPaymentIntents();
    expect(result.archivedCount).toBe(0);

    const { rows: archivedPayments } = await pool.query("SELECT * FROM archived_payments");
    expect(archivedPayments.length).toBe(0);
  });

  it("should rollback transaction if insertion fails", async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);

    await pool.query(
      "INSERT INTO payments (id, merchant_id, amount, asset, recipient, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      ["44444444-4444-4444-4444-444444444444", "11111111-1111-1111-1111-111111111111", 100.00, "XLM", "GB123", oldDate, oldDate]
    );

    // Mock insertion failure to test rollback
    const realConnect = pool.connect.bind(pool);
    vi.spyOn(pool, 'connect').mockImplementation(async () => {
      const client = await realConnect();
      const realQuery = client.query.bind(client);
      client.query = async (text, params) => {
        if (typeof text === 'string' && text.includes('INSERT INTO archived_payments')) {
          throw new Error("Simulated insertion failure");
        }
        return realQuery(text, params);
      };
      return client;
    });

    await expect(archiveOldPaymentIntents()).rejects.toThrow("Simulated insertion failure");

    // Original payment should still exist
    const { rows: remainingPayments } = await pool.query("SELECT * FROM payments");
    expect(remainingPayments.length).toBe(1);
    expect(remainingPayments[0].id).toBe("44444444-4444-4444-4444-444444444444");

    // Archived table should remain empty
    const { rows: archivedPayments } = await pool.query("SELECT * FROM archived_payments");
    expect(archivedPayments.length).toBe(0);
  });
});
