export const ASSET_DEFAULTS = {
  USDC: {
    testnet: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    public: "GA5ZSEJYB37JRC5AVCIAZDL2Y44SCRY6S4T6R4V4E35I7XY7C2NMA72S"
  }
};

function normalizeAssetCode(assetCode) {
  return String(assetCode || "").trim().toUpperCase();
}

export function getDefaultAssetIssuer(assetCode, network = process.env.STELLAR_NETWORK || "testnet") {
  const asset = normalizeAssetCode(assetCode);
  const networkKey = String(network || "testnet").trim().toLowerCase();
  const defaults = ASSET_DEFAULTS[asset];

  if (!defaults) {
    return null;
  }

  return defaults[networkKey] || defaults.testnet || null;
}

export function resolveAssetIssuer(assetCode, assetIssuer, network = process.env.STELLAR_NETWORK || "testnet") {
  const asset = normalizeAssetCode(assetCode);

  if (asset === "XLM") {
    return null;
  }

  if (typeof assetIssuer === "string" && assetIssuer.trim().length > 0) {
    return assetIssuer.trim();
  }

  const issuer = getDefaultAssetIssuer(asset, network);
  if (issuer) {
    console.log(`Resolved default asset issuer for ${assetCode}: ${issuer}`);
  } else {
    console.warn(`Could not resolve asset issuer for ${assetCode}`);
  }
  return issuer;
}

export function getPossibleAssets() {
  return Object.keys(ASSET_DEFAULTS);
}
