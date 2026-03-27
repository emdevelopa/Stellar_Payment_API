import * as StellarSdk from "stellar-sdk";

export interface PaymentTransactionParams {
  sourcePublicKey: string;
  destinationPublicKey: string;
  amount: string;
  assetCode: string;
  assetIssuer: string | null;
  horizonUrl: string;
  networkPassphrase: string;
}

/**
 * Resolve a Stellar asset based on code and issuer
 */
export function resolveAsset(assetCode: string, assetIssuer: string | null): StellarSdk.Asset {
  if (assetCode === "XLM" || assetCode === "native") {
    return StellarSdk.Asset.native();
  }

  if (!assetIssuer) {
    throw new Error("Asset issuer is required for non-native assets");
  }

  return new StellarSdk.Asset(assetCode, assetIssuer);
}

/**
 * Build a payment transaction for submission to the Stellar network
 */
export async function buildPaymentTransaction(
  params: PaymentTransactionParams
): Promise<string> {
  try {
    const server = new StellarSdk.Horizon.Server(params.horizonUrl);

    // Load the source account details
    const sourceAccount = await server.loadAccount(params.sourcePublicKey);

    // Resolve the asset
    const asset = resolveAsset(params.assetCode, params.assetIssuer);

    // Build the transaction
    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: params.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: params.destinationPublicKey,
          asset: asset,
          amount: params.amount,
        })
      )
      .setTimeout(300)
      .build();

    return transaction.toXDR();
  } catch (error) {
    throw new Error(
      `Failed to build payment transaction: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * SEP-0001: Discover the anchor services from stellar.toml
 */
export async function getAnchorServices(domain: string) {
  try {
    const toml = await StellarSdk.StellarToml.Config.from(domain);
    return {
      transferServer: toml.TRANSFER_SERVER_SEP0024 || toml.TRANSFER_SERVER,
      webAuthEndpoint: toml.WEB_AUTH_ENDPOINT,
      signingKey: toml.SIGNING_KEY,
    };
  } catch (error) {
    throw new Error(`Failed to discover anchor services for ${domain}: ${error}`);
  }
}

/**
 * SEP-0010: Authenticate with the anchor to get a JWT
 */
export async function authenticateWithAnchor(
  account: string,
  authEndpoint: string,
  signTransaction: (xdr: string) => Promise<string>
): Promise<string> {
  // 1. Fetch challenge from anchor
  const challengeRes = await fetch(`${authEndpoint}?account=${account}`);
  const challengeData = await challengeRes.json();
  
  if (!challengeData.transaction) {
    throw new Error("Failed to get challenge transaction from anchor");
  }

  // 2. Sign challenge with user's wallet
  const signedXDR = await signTransaction(challengeData.transaction);

  // 3. Submit signed challenge to get JWT
  const loginRes = await fetch(authEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedXDR }),
  });
  
  const loginData = await loginRes.json();
  if (!loginData.token) {
    throw new Error("Failed to authenticate with anchor: No token returned");
  }

  return loginData.token;
}

/**
 * SEP-0024: Initiate a hosted withdrawal to get the interactive URL
 */
export async function initiateWithdrawal(
  transferServer: string,
  jwt: string,
  assetCode: string,
  account: string
): Promise<string> {
  const formData = new FormData();
  formData.append("asset_code", assetCode);
  formData.append("account", account);

  const res = await fetch(`${transferServer}/transactions/withdraw/interactive`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
    body: formData,
  });

  const data = await res.json();
  if (!data.url) {
    throw new Error("Failed to initiate withdrawal: No URL returned");
  }

  return data.url;
}

