/**
 * Webhook Payload Versioning System
 *
 * WHY IT EXISTS:
 * Webhook payload structure may change as the API evolves. Rather than
 * mutating existing payloads and breaking merchant integrations, each
 * merchant is assigned a `webhook_version` (e.g. "v1"). Payloads are
 * built according to that version so older integrations keep receiving
 * the exact format they were built against.
 *
 * HOW TO ADD A NEW VERSION (e.g. "v2"):
 * 1. Create `src/webhooks/versions/v2.js` exporting `buildPayload(eventData)`.
 * 2. Import it below and add an entry to the `VERSIONS` map.
 * 3. Update the DB default for `webhook_version` in `schema.sql` and the
 *    migration so new merchants receive the latest version automatically.
 */

import * as v1 from "./versions/v1.js";

/** Registry of all supported webhook payload versions. */
const VERSIONS = {
  v1,
};

/** Fallback version used when a merchant's version is absent or unrecognised. */
const DEFAULT_VERSION = "v1";

/**
 * Build a versioned webhook payload for the given event.
 *
 * @param {string|null|undefined} version - The merchant's assigned webhook_version.
 * @param {string} event                  - Event type, e.g. "payment.confirmed".
 * @param {Record<string, unknown>} data  - Raw event data fields.
 * @returns {Record<string, unknown>}     - The shaped payload object.
 */
export function getPayloadForVersion(version, event, data) {
  const key = version && VERSIONS[version] ? version : DEFAULT_VERSION;
  return VERSIONS[key].buildPayload({ event, ...data });
}
