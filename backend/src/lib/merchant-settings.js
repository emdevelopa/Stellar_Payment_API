export const DEFAULT_MERCHANT_SETTINGS = Object.freeze({
  send_success_emails: true,
});

/**
 * Resolve stored/submitted settings into the canonical shape. Only OWN,
 * correctly-typed properties are honoured, so inherited (prototype-polluted)
 * values and unknown keys never leak into persisted settings (issue #1482).
 */
export function resolveMerchantSettings(rawSettings) {
  const input =
    rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? rawSettings
      : {};

  return {
    send_success_emails:
      Object.hasOwn(input, "send_success_emails") &&
      typeof input.send_success_emails === "boolean"
        ? input.send_success_emails
        : DEFAULT_MERCHANT_SETTINGS.send_success_emails,
  };
}
