/**
 * Webhook Payload Builder — Version 1 (v1)
 *
 * STRUCTURE:
 * Flat JSON object. All event fields sit at the top level — no nested
 * "data" envelope. This mirrors the original payload format shipped with
 * the API, so all merchants currently integrated receive exactly what they
 * always have when assigned webhook_version = "v1".
 *
 * EVENTS SUPPORTED:
 *   - "payment.confirmed"  — emitted when a Stellar payment is verified
 *   - "ping"               — emitted by the /api/test-webhook endpoint
 *
 * DIFFERENCES FROM OTHER VERSIONS:
 *   (none — this is the original/base version)
 */

/**
 * Build a v1 webhook payload.
 *
 * @param {{ event: string, [key: string]: unknown }} eventData
 * @returns {Record<string, unknown>}
 */
export function buildPayload(eventData) {
  if (eventData.event === "payment.confirmed") {
    return {
      event: "payment.confirmed",
      payment_id: eventData.payment_id,
      amount: eventData.amount,
      asset: eventData.asset,
      asset_issuer: eventData.asset_issuer,
      recipient: eventData.recipient,
      tx_id: eventData.tx_id,
    };
  }

  if (eventData.event === "ping") {
    return {
      event: "ping",
      merchant_id: eventData.merchant_id,
      timestamp: eventData.timestamp,
    };
  }

  // Passthrough for any future events not yet explicitly shaped
  return eventData;
}
