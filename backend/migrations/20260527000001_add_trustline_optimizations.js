/**
 * Migration: Add trustline management optimizations
 * 
 * This migration supports Task #596: Optimize SQL queries in Trustline Manager
 * 
 * Changes:
 * 1. Add composite indexes for efficient trustline-related queries
 * 2. Add GIN index for JSONB allowed_issuers column
 * 3. Add partial indexes for performance optimization
 * 4. Add trustline verification audit table
 */

export async function up(knex) {
  // Add trustline verification audit table for enhanced security tracking
  await knex.schema.createTable('trustline_verifications', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('merchant_id').references('id').inTable('merchants').onDelete('SET NULL');
    table.text('tx_hash').notNullable();
    table.text('operation_type').notNullable(); // changeTrust, allowTrust
    table.text('asset_code').notNullable();
    table.text('asset_issuer');
    table.boolean('signature_valid').notNullable();
    table.boolean('is_multisig').defaultTo(false);
    table.integer('signature_count').defaultTo(0);
    table.boolean('threshold_met').defaultTo(false);
    table.text('verification_reason');
    table.jsonb('verification_metadata');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Indexes for trustline verification queries
    table.index(['merchant_id', 'created_at']);
    table.index(['tx_hash']);
    table.index(['asset_code', 'asset_issuer']);
    table.index(['signature_valid', 'created_at']);
  });

  // Add composite index for asset-based payment queries (if not exists)
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_merchant_asset_status_created 
    ON payments(merchant_id, asset, status, created_at DESC) 
    WHERE deleted_at IS NULL
  `);

  // Add index for asset issuer lookups
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_asset_issuer_created 
    ON payments(asset_issuer, created_at DESC) 
    WHERE deleted_at IS NULL AND asset_issuer IS NOT NULL
  `);

  // Add GIN index for merchant allowed issuers (JSONB operations)
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_allowed_issuers 
    ON merchants USING GIN(allowed_issuers) 
    WHERE deleted_at IS NULL
  `);

  // Add partial index for pending payments monitoring
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_pending_created 
    ON payments(created_at DESC) 
    WHERE status = 'pending' AND deleted_at IS NULL
  `);

  // Add index for payment limits JSONB queries
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_payment_limits 
    ON merchants USING GIN(payment_limits) 
    WHERE deleted_at IS NULL AND payment_limits IS NOT NULL
  `);

  // Add composite index for asset statistics queries
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_asset_stats 
    ON payments(merchant_id, asset, asset_issuer, status, created_at) 
    WHERE deleted_at IS NULL
  `);

  // Add index for completion duration analysis
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_completion_duration 
    ON payments(completion_duration_seconds, created_at) 
    WHERE completion_duration_seconds IS NOT NULL AND deleted_at IS NULL
  `);

  // Add function for efficient asset validation
  await knex.raw(`
    CREATE OR REPLACE FUNCTION validate_merchant_asset_issuer(
      merchant_uuid UUID,
      asset_code TEXT,
      asset_issuer TEXT
    ) RETURNS BOOLEAN AS $$
    DECLARE
      allowed_issuers JSONB;
    BEGIN
      -- Get merchant's allowed issuers
      SELECT m.allowed_issuers INTO allowed_issuers
      FROM merchants m
      WHERE m.id = merchant_uuid AND m.deleted_at IS NULL;
      
      -- If no restrictions or XLM, allow
      IF allowed_issuers IS NULL OR 
         jsonb_array_length(allowed_issuers) = 0 OR 
         asset_code = 'XLM' THEN
        RETURN TRUE;
      END IF;
      
      -- Check if issuer is in allowed list
      RETURN allowed_issuers ? asset_issuer;
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
  `);

  // Add function for payment limit validation
  await knex.raw(`
    CREATE OR REPLACE FUNCTION validate_payment_limits(
      merchant_uuid UUID,
      asset_code TEXT,
      amount NUMERIC
    ) RETURNS JSONB AS $$
    DECLARE
      limits JSONB;
      asset_limits JSONB;
      min_amount NUMERIC;
      max_amount NUMERIC;
    BEGIN
      -- Get merchant's payment limits
      SELECT m.payment_limits INTO limits
      FROM merchants m
      WHERE m.id = merchant_uuid AND m.deleted_at IS NULL;
      
      -- If no limits configured, allow
      IF limits IS NULL THEN
        RETURN jsonb_build_object('valid', true, 'reason', 'no_limits_configured');
      END IF;
      
      -- Get limits for specific asset
      asset_limits := limits -> asset_code;
      
      -- If no limits for this asset, allow
      IF asset_limits IS NULL THEN
        RETURN jsonb_build_object('valid', true, 'reason', 'no_asset_limits');
      END IF;
      
      -- Check minimum
      min_amount := (asset_limits ->> 'min')::NUMERIC;
      IF min_amount IS NOT NULL AND amount < min_amount THEN
        RETURN jsonb_build_object(
          'valid', false, 
          'reason', 'below_minimum',
          'min', min_amount,
          'delta', min_amount - amount
        );
      END IF;
      
      -- Check maximum
      max_amount := (asset_limits ->> 'max')::NUMERIC;
      IF max_amount IS NOT NULL AND amount > max_amount THEN
        RETURN jsonb_build_object(
          'valid', false, 
          'reason', 'above_maximum',
          'max', max_amount,
          'delta', amount - max_amount
        );
      END IF;
      
      RETURN jsonb_build_object('valid', true, 'reason', 'within_limits');
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
  `);

  // Add materialized view for merchant asset statistics (refreshed periodically)
  await knex.raw(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS merchant_asset_stats AS
    SELECT 
      p.merchant_id,
      p.asset,
      p.asset_issuer,
      COUNT(*) as total_payments,
      COUNT(CASE WHEN p.status = 'confirmed' THEN 1 END) as confirmed_payments,
      COUNT(CASE WHEN p.status = 'pending' THEN 1 END) as pending_payments,
      COUNT(CASE WHEN p.status = 'failed' THEN 1 END) as failed_payments,
      SUM(p.amount) as total_volume,
      AVG(p.amount) as avg_amount,
      MIN(p.amount) as min_amount,
      MAX(p.amount) as max_amount,
      AVG(CASE WHEN p.completion_duration_seconds IS NOT NULL 
          THEN p.completion_duration_seconds END) as avg_completion_time,
      MIN(p.created_at) as first_payment_at,
      MAX(p.created_at) as last_payment_at,
      COUNT(CASE WHEN p.created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) as payments_24h,
      COUNT(CASE WHEN p.created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as payments_7d,
      ROUND(
        CASE 
          WHEN COUNT(*) > 0 
          THEN (COUNT(CASE WHEN p.status = 'failed' THEN 1 END)::NUMERIC / COUNT(*)::NUMERIC) * 100
          ELSE 0 
        END, 2
      ) as failure_rate_percent
    FROM payments p
    WHERE p.deleted_at IS NULL
    GROUP BY p.merchant_id, p.asset, p.asset_issuer;
  `);

  // Add unique index on materialized view
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_asset_stats_unique
    ON merchant_asset_stats(merchant_id, asset, COALESCE(asset_issuer, ''));
  `);

  // Add index for fast lookups
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_merchant_asset_stats_merchant
    ON merchant_asset_stats(merchant_id, total_volume DESC);
  `);
}

export async function down(knex) {
  // Drop materialized view and its indexes
  await knex.raw('DROP MATERIALIZED VIEW IF EXISTS merchant_asset_stats');

  // Drop custom functions
  await knex.raw('DROP FUNCTION IF EXISTS validate_merchant_asset_issuer(UUID, TEXT, TEXT)');
  await knex.raw('DROP FUNCTION IF EXISTS validate_payment_limits(UUID, TEXT, NUMERIC)');

  // Drop indexes (in reverse order)
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_payments_completion_duration');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_payments_asset_stats');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_merchants_payment_limits');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_payments_pending_created');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_merchants_allowed_issuers');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_payments_asset_issuer_created');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_payments_merchant_asset_status_created');

  // Drop trustline verifications table
  await knex.schema.dropTableIfExists('trustline_verifications');
}