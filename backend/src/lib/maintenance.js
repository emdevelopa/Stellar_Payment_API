import { pool } from "./db.js";
import logger from "./logger.js"; // Assuming a pino logger exists

/**
 * Archives payment intents from the 'payments' table that are older than 90 days.
 * Moves them to 'archived_payments' atomically using a transaction.
 * 
 * @returns {Promise<{ archivedCount: number }>}
 */
export async function archiveOldPaymentIntents() {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  let archivedCount = 0;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    
    // 1. Select old payments
    const { rows: oldPayments } = await client.query(
      "SELECT * FROM payments WHERE created_at < $1",
      [ninetyDaysAgo]
    );

    if (oldPayments.length === 0) {
      await client.query("ROLLBACK");
      client.release();
      return { archivedCount: 0 };
    }

    // 2. Insert into archived_payments using bulk copy
    // We strictly use INSERT INTO ... SELECT
    await client.query(
      `INSERT INTO archived_payments (
         id, merchant_id, amount, asset, asset_issuer, recipient, description, 
         memo, memo_type, webhook_url, status, tx_id, metadata, 
         completion_duration_seconds, created_at, updated_at, deleted_at
       )
       SELECT 
         id, merchant_id, amount, asset, asset_issuer, recipient, description, 
         memo, memo_type, webhook_url, status, tx_id, metadata, 
         completion_duration_seconds, created_at, updated_at, deleted_at
       FROM payments
       WHERE created_at < $1`,
      [ninetyDaysAgo]
    );

    // 3. Delete from payments
    const { rowCount: deletedCount } = await client.query(
      "DELETE FROM payments WHERE created_at < $1",
      [ninetyDaysAgo]
    );

    archivedCount = deletedCount;

    await client.query("COMMIT");

    if (archivedCount > 0) {
      if (logger && typeof logger.info === 'function') {
        logger.info({ archivedCount }, "Successfully archived old payments");
      }
    }
  } catch (error) {
    await client.query("ROLLBACK");
    if (logger && typeof logger.error === 'function') {
      logger.error({ error }, "Failed to archive old payments");
    } else {
        console.error("Failed to archive old payments:", error);
    }
    throw error;
  } finally {
    client.release();
  }
  
  return { archivedCount };
}
