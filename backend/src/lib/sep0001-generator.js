/**
 * SEP-0001 stellar.toml generator
 * Generates TOML content for merchant's Stellar business information
 */

/**
 * Escape TOML string values
 */
function escapeTomlString(str) {
  if (!str) return '""';
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/**
 * Generate TOML content from merchant configuration
 */
export function generateStellarToml(merchant) {
  if (!merchant) {
    throw new Error("Merchant configuration required");
  }

  const lines = [];

  // NETWORK_PASSPHRASE - required for Stellar
  const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";
  lines.push(`NETWORK_PASSPHRASE = ${escapeTomlString(networkPassphrase)}`);
  lines.push("");

  // TRANSFER_SERVER - this API's payment endpoint
  const transferServer = process.env.TRANSFER_SERVER_URL || `${process.env.API_BASE_URL || "http://localhost:4000"}/api`;
  lines.push(`TRANSFER_SERVER = ${escapeTomlString(transferServer)}`);
  lines.push("");

  // FEDERATION_SERVER - optional, for name resolution
  if (process.env.FEDERATION_SERVER_URL) {
    lines.push(`FEDERATION_SERVER = ${escapeTomlString(process.env.FEDERATION_SERVER_URL)}`);
    lines.push("");
  }

  // ACCOUNTS - merchant's Stellar accounts
  if (merchant.recipient) {
    lines.push(`ACCOUNTS = [${escapeTomlString(merchant.recipient)}]`);
    lines.push("");
  }

  // DOCUMENTATION - link to API documentation
  const docsUrl = process.env.DOCS_URL || `${process.env.API_BASE_URL || "http://localhost:4000"}/api-docs`;
  lines.push(`DOCUMENTATION = ${escapeTomlString(docsUrl)}`);
  lines.push("");

  // SIGNING_KEY - optional, for transaction signing
  if (process.env.SIGNING_KEY) {
    lines.push(`SIGNING_KEY = ${escapeTomlString(process.env.SIGNING_KEY)}`);
    lines.push("");
  }

  // ORG section with merchant information
  lines.push("[ORG]");
  lines.push(`name = ${escapeTomlString(merchant.business_name || "Stellar Payment Merchant")}`);
  
  if (merchant.email) {
    lines.push(`contact = ${escapeTomlString(merchant.email)}`);
  }

  if (merchant.notification_email) {
    lines.push(`support = ${escapeTomlString(merchant.notification_email)}`);
  }

  // Add homepage if available in branding config
  if (merchant.branding_config?.homepage) {
    lines.push(`homepage = ${escapeTomlString(merchant.branding_config.homepage)}`);
  }

  // Add logo if available in branding config
  if (merchant.branding_config?.logo_url) {
    lines.push(`logo = ${escapeTomlString(merchant.branding_config.logo_url)}`);
  }

  return lines.join("\n");
}

/**
 * Validate TOML content (basic validation)
 */
export function validateStellarToml(tomlContent) {
  if (!tomlContent) return false;
  
  // Check for required fields
  const hasNetworkPassphrase = tomlContent.includes("NETWORK_PASSPHRASE");
  const hasTransferServer = tomlContent.includes("TRANSFER_SERVER");
  
  return hasNetworkPassphrase && hasTransferServer;
}
