-- Optional database-level scheduler for webhook log retention.
-- Safe to run multiple times.

-- Compliance warning:
-- Payment audit logs may require retention longer than 30 days depending on policy/regulation.
-- Confirm webhook_delivery_logs stores operational delivery telemetry only before enabling this policy.

CREATE OR REPLACE FUNCTION purge_webhook_delivery_logs(
  p_retention_days integer DEFAULT 30,
  p_batch_size integer DEFAULT 1000
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted_batch integer := 0;
  v_total_deleted bigint := 0;
BEGIN
  IF p_retention_days <= 0 THEN
    RAISE EXCEPTION 'p_retention_days must be > 0';
  END IF;
  IF p_batch_size <= 0 THEN
    RAISE EXCEPTION 'p_batch_size must be > 0';
  END IF;

  -- Safety check: ensure an index exists on timestamp to avoid table-wide sequential scans.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'webhook_delivery_logs'
      AND indexdef ILIKE '%timestamp%'
  ) THEN
    RAISE EXCEPTION 'Missing index on webhook_delivery_logs.timestamp';
  END IF;

  LOOP
    WITH rows_to_delete AS (
      SELECT id
      FROM webhook_delivery_logs
      WHERE "timestamp" < NOW() - make_interval(days => p_retention_days)
      ORDER BY "timestamp" ASC
      LIMIT p_batch_size
    )
    DELETE FROM webhook_delivery_logs t
    USING rows_to_delete d
    WHERE t.id = d.id;

    GET DIAGNOSTICS v_deleted_batch = ROW_COUNT;
    v_total_deleted := v_total_deleted + v_deleted_batch;

    EXIT WHEN v_deleted_batch = 0;
  END LOOP;

  RETURN v_total_deleted;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'purge-webhook-delivery-logs-daily',
      '0 2 * * *',
      $$SELECT purge_webhook_delivery_logs(
          COALESCE(NULLIF(current_setting('app.log_retention_days', true), '')::int, 30),
          COALESCE(NULLIF(current_setting('app.log_purge_batch_size', true), '')::int, 1000)
        );$$
    );
  ELSE
    RAISE NOTICE 'pg_cron extension not available; schedule at app/CI layer.';
  END IF;
END;
$$;
