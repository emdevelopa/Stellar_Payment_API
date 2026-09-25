/**
 * Migration: Add `reason` column to audit_logs (issue #871 SEP-10 security audit).
 *
 * SEP10_AUTH_SECURITY_AUDIT.md's own "Recommendations (future work)" #2 asks
 * for SEP-10 error codes to be included in login audit events for security
 * monitoring. `status` only ever records "success"/"failure" — there's
 * nowhere to record *which* SEP-10 check rejected a verify attempt
 * (NONCE_REPLAY, CHALLENGE_EXPIRED, HOME_DOMAIN_MISMATCH, etc.), so those
 * events are currently indistinguishable from each other in the audit trail.
 */

export async function up(knex) {
  await knex.schema.alterTable("audit_logs", (t) => {
    t.text("reason");
  });
}

export async function down(knex) {
  await knex.schema.alterTable("audit_logs", (t) => {
    t.dropColumn("reason");
  });
}
