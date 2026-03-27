import { pool } from "./db.js";

/**
 * Executes a callback within a transaction where the merchant context is set.
 * This ensures Row Level Security (RLS) is enforced for direct pg pool queries.
 */
export async function withMerchantContext(merchantId, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (merchantId) {
      await client.query("SET LOCAL app.current_merchant_id = $1", [
        merchantId,
      ]);
    }
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
