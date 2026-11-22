/**
 * merchant-recovery.js
 *
 * Automated retry and dead-letter recovery for the Merchant Onboarding and Key
 * Lifecycle Route (#1771).
 *
 * Webhook domain verification does network work (fetching a proof file from the
 * merchant's domain) and then persists the result on the merchant row. If that
 * persistence fails transiently, the verification result is lost and the
 * merchant must repeat a slow, rate-limited action. Now:
 *
 *   1. The write is retried with full-jitter backoff on transient failures
 *      (network errors, 408/429/5xx, connection-class Postgres errors).
 *   2. If it still fails transiently, the verification RESULT is dead-lettered
 *      (keyed per merchant, so retries coalesce) and the route answers 202 with
 *      the result and `persisted: false`, instead of a 500 that discards it.
 *   3. Dead-lettered writes are recovered in the background with backoff, and
 *      after repeated failure are isolated as poison pills.
 *
 * Recovery is a read-merge-write of ONLY the `webhook_domain_verification`
 * metadata key, never a replacement of the whole metadata object, so a late
 * recovery cannot overwrite other metadata the merchant changed in the meantime.
 *
 * Credential rotations are deliberately NOT retried or dead-lettered: they are
 * not idempotent, and queueing a secret would put it in process memory. They are
 * protected by locking and compare-and-swap instead (merchant-key-lifecycle.js).
 *
 * Queue entries contain the merchant id and the verification record (domain,
 * challenge token, status) and never an API key, webhook secret or password.
 */

import { logger as defaultLogger } from "./logger.js";
import { retrySupabaseRead, resolveBackoffOptions } from "./backoff-retry.js";
import { isRetryableSessionError } from "./payment-session-retry.js";
import { RecoveryQueue } from "./recovery-queue.js";
import {
  merchantDlqDepth,
  merchantDlqOperationsTotal,
  merchantPersistRetriesTotal,
} from "./merchant-lifecycle-metrics.js";

export const VERIFICATION_METADATA_KEY = "webhook_domain_verification";

const RETRY_SPEC = Object.freeze({
  envPrefix: "MERCHANT_PERSIST_RETRY",
  defaults: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000 },
  maxAttemptsCeiling: 5,
  maxDelayCeilingMs: 5_000,
});

const RECOVERY_MIN_INTERVAL_MS = 15_000;

export const merchantDlq = new RecoveryQueue({
  name: "merchant_lifecycle",
  maxCapacity: 500,
  maxAttempts: 5,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  metrics: {
    onDepth: (n) => merchantDlqDepth.set(n),
    onOperation: (action, status) => merchantDlqOperationsTotal.inc({ action, status }),
  },
});

let lastRecoveryStartedAt = 0;

export function resetMerchantRecoveryForTests() {
  merchantDlq.clear();
  lastRecoveryStartedAt = 0;
}

function dlqKey(merchantId) {
  return `verification:${merchantId}`;
}

/**
 * Persist a webhook domain verification result with retry and dead-lettering.
 *
 * @param {object} supabase
 * @param {{ merchantId: string, metadata: object, verification: object }} data
 *   `metadata` is the full next metadata (used for the immediate write);
 *   `verification` is the single record that is re-applied on recovery.
 * @returns {Promise<{ persisted: true } | { persisted: false, queued: true }>}
 * @throws the database error (status 500) when the failure is not transient.
 */
export async function persistVerificationWithRecovery(
  supabase,
  { merchantId, metadata, verification },
  options = {},
) {
  const { logger = defaultLogger, sleep, random, scheduleRecovery: shouldSchedule = true } = options;

  const result = await retrySupabaseRead(
    () => supabase.from("merchants").update({ metadata }).eq("id", merchantId),
    {
      resolved: resolveBackoffOptions({}, process.env, RETRY_SPEC),
      label: "merchant_verification_persist",
      onRetry: () => merchantPersistRetriesTotal.inc(),
      ...(sleep ? { sleep } : {}),
      ...(random ? { random } : {}),
      logger,
    },
  );

  const error = result?.error;
  if (!error) return { persisted: true };

  if (isRetryableSessionError(error)) {
    merchantDlq.enqueue(dlqKey(merchantId), { merchantId, verification }, error);
    if (shouldSchedule) scheduleMerchantRecovery({ supabase, logger });
    return { persisted: false, queued: true };
  }

  error.status = 500;
  throw error;
}

/**
 * Re-apply one dead-lettered verification: read the current metadata, merge only
 * the verification record, write it back. Throws to signal failure; errors that
 * can never succeed are marked non-retryable so the entry is isolated at once.
 */
async function applyVerification(supabase, entry) {
  const { merchantId, verification } = entry.payload;

  const { data, error: readError } = await supabase
    .from("merchants")
    .select("metadata")
    .eq("id", merchantId)
    .maybeSingle();
  if (readError) throw readError;
  if (!data) {
    const gone = new Error("Merchant no longer exists");
    gone.retryable = false;
    throw gone;
  }

  const current =
    data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? data.metadata
      : {};
  const { error: writeError } = await supabase
    .from("merchants")
    .update({ metadata: { ...current, [VERIFICATION_METADATA_KEY]: verification } })
    .eq("id", merchantId);
  if (writeError) {
    if (!isRetryableSessionError(writeError)) writeError.retryable = false;
    throw writeError;
  }
}

/**
 * Re-drive due dead-lettered merchant writes. Also suitable for a scheduled job.
 */
export async function recoverMerchantDlq({ supabase, maxBatch = 10 } = {}) {
  if (!supabase) throw new TypeError("recoverMerchantDlq requires a supabase client");
  return merchantDlq.recover((entry) => applyVerification(supabase, entry), { maxBatch });
}

/**
 * Throttled, fire-and-forget recovery. At most one run per
 * RECOVERY_MIN_INTERVAL_MS; no timer exists until a failure occurs.
 */
export function scheduleMerchantRecovery({ supabase, now = Date.now, logger = defaultLogger } = {}) {
  const current = now();
  if (current - lastRecoveryStartedAt < RECOVERY_MIN_INTERVAL_MS) return false;
  lastRecoveryStartedAt = current;

  const timer = setTimeout(() => {
    recoverMerchantDlq({ supabase }).catch((err) => {
      logger.error?.({ err: err?.message }, "Merchant DLQ recovery run failed");
    });
  }, 0);
  timer.unref?.();
  return true;
}
