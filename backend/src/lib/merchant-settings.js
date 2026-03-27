export const DEFAULT_MERCHANT_SETTINGS = Object.freeze({
  send_success_emails: true,
});

export function resolveMerchantSettings(rawSettings) {
  const input =
    rawSettings && typeof rawSettings === "object" ? rawSettings : {};

  return {
    send_success_emails:
      typeof input.send_success_emails === "boolean"
        ? input.send_success_emails
        : DEFAULT_MERCHANT_SETTINGS.send_success_emails,
  };
}
