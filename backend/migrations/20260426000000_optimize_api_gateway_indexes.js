/**
 * Migration: Optimize API Gateway Security queries
 * Adds composite indexes for faster API key lookups during authentication.
 */

export async function up(knex) {
  // Composite index for current API key lookups - covers the most frequent query path
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS merchants_api_key_active_idx 
    ON merchants(api_key, deleted_at) 
    WHERE api_key IS NOT NULL
  `);

  // Composite index for old API key lookups during rotation overlap
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS merchants_api_key_old_active_idx 
    ON merchants(api_key_old, api_key_old_expires_at) 
    WHERE api_key_old IS NOT NULL
  `);

  // Composite index for audit logs - covers both the COUNT and paginated SELECT queries
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS audit_logs_merchant_timestamp_idx 
    ON audit_logs(merchant_id, timestamp DESC)
  `);
}

export async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS merchants_api_key_active_idx`);
  await knex.raw(`DROP INDEX IF EXISTS merchants_api_key_old_active_idx`);
  await knex.raw(`DROP INDEX IF EXISTS audit_logs_merchant_timestamp_idx`);
}