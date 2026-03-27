/**
 * Builds the v1 webhook payload.
 *
 * This version corresponds to the original format of the webhooks,
 * providing flat properties and the exact field names expected by early integrations.
 *
 * @param {Object} eventData - The internal data object containing payment details.
 * @returns {Object} The formatted payload to send.
 */
export function buildPayload(eventData) {
  return {
    event: eventData.event,
    payment_id: eventData.payment_id,
    amount: eventData.amount,
    asset: eventData.asset,
    asset_issuer: eventData.asset_issuer,
    recipient: eventData.recipient,
    tx_id: eventData.tx_id
  };
}
