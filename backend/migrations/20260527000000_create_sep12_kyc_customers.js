/**
 * Migration: SEP-12 KYC customers
 *
 * Backing store for the SEP-12 KYC integration. Schema and indexes are tuned
 * for the two hot query paths (issue #591):
 *   - upsert/lookup by (stellar_account, memo)  -> unique composite index
 *   - status filtering for compliance dashboards -> partial-friendly index
 *
 * `memo` defaults to '' (rather than NULL) so the composite uniqueness used by
 * the PUT upsert's ON CONFLICT target is well-defined.
 */

export async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS sep12_kyc_customers (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      stellar_account text        NOT NULL,
      memo            text        NOT NULL DEFAULT '',
      fields          jsonb       NOT NULL DEFAULT '{}'::jsonb,
      status          text        NOT NULL DEFAULT 'NEEDS_INFO',
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now()
    )
  `);

  // Hot path: PUT upsert + GET lookup. Doubles as the ON CONFLICT target.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sep12_kyc_account_memo_uidx
    ON sep12_kyc_customers (stellar_account, memo)
  `);

  // Compliance dashboards filter by status.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS sep12_kyc_status_idx
    ON sep12_kyc_customers (status)
  `);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS sep12_kyc_customers`);
}
