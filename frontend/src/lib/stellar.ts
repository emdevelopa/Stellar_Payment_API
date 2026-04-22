import * as StellarSdk from "stellar-sdk";

export interface PaymentTransactionParams {
  sourcePublicKey: string;
  destinationPublicKey: string;
  amount: string;
  assetCode: string;
  assetIssuer: string | null;
  memo?: string | null;
  memoType?: string | null;
  horizonUrl: string;
  networkPassphrase: string;
}

export interface PathPaymentTransactionParams {
  sourcePublicKey: string;
  destinationPublicKey: string;
  sendMax: string;
  sendAssetCode: string;
  sendAssetIssuer: string | null;
  destAmount: string;
  destAssetCode: string;
  destAssetIssuer: string | null;
  path: Array<{ asset_code: string; asset_issuer: string | null }>;
  memo?: string | null;
  memoType?: string | null;
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

function resolveMemo(
  memo: string | null | undefined,
  memoType: string | null | undefined
): StellarSdk.Memo | undefined {
  if (!memo || !memoType) {
    return undefined;
  }

  switch (memoType.toLowerCase()) {
    case "text":
      return StellarSdk.Memo.text(memo);
    case "id":
      return StellarSdk.Memo.id(memo);
    case "hash":
      return StellarSdk.Memo.hash(memo);
    case "return":
      return StellarSdk.Memo.return(memo);
    default:
      throw new Error(`Unsupported memo type: ${memoType}`);
  }
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
    const transactionBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: params.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: params.destinationPublicKey,
          asset: asset,
          amount: params.amount,
        })
      );

    const memo = resolveMemo(params.memo, params.memoType);
    if (memo) {
      transactionBuilder.addMemo(memo);
    }

    const transaction = transactionBuilder.setTimeout(300).build();

    return transaction.toXDR();
  } catch (error) {
    throw new Error(
      `Failed to build payment transaction: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Build a path payment (strict receive) transaction.
 * The sender pays up to `sendMax` of the source asset so that the
 * destination receives exactly `destAmount` of the destination asset.
 */
export async function buildPathPaymentTransaction(
  params: PathPaymentTransactionParams
): Promise<string> {
  try {
    const server = new StellarSdk.Horizon.Server(params.horizonUrl);
    const sourceAccount = await server.loadAccount(params.sourcePublicKey);

    const sendAsset = resolveAsset(params.sendAssetCode, params.sendAssetIssuer);
    const destAsset = resolveAsset(params.destAssetCode, params.destAssetIssuer);

    const stellarPath = params.path.map((p) => resolveAsset(p.asset_code, p.asset_issuer));

    const transactionBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: params.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.pathPaymentStrictReceive({
          sendAsset,
          sendMax: params.sendMax,
          destination: params.destinationPublicKey,
          destAsset,
          destAmount: params.destAmount,
          path: stellarPath,
        })
      );

    const memo = resolveMemo(params.memo, params.memoType);
    if (memo) {
      transactionBuilder.addMemo(memo);
    }

    const transaction = transactionBuilder.setTimeout(300).build();

    return transaction.toXDR();
  } catch (error) {
    throw new Error(
      `Failed to build path payment transaction: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * SEP-0001: Discover the anchor services from stellar.toml
 */
export async function getAnchorServices(domain: string) {
  try {
    const toml = await StellarSdk.StellarToml.Resolver.resolve(domain);
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

export interface AssetBalance {
  code: string;
  issuer: string | null;
  balance: string;
}

/**
 * Fetch balances for a Stellar account and return them in a simplified format.
 */
export async function getAccountBalances(
  publicKey: string,
  horizonUrl: string
): Promise<AssetBalance[]> {
  try {
    const server = new StellarSdk.Horizon.Server(horizonUrl);
    const account = await server.loadAccount(publicKey);

    return account.balances.map((b) => {
      if (b.asset_type === "native") {
        return {
          code: "XLM",
          issuer: null,
          balance: b.balance,
        };
      }
      return {
        code: (b as { asset_code?: string }).asset_code || "UNKNOWN",
        issuer: (b as { asset_issuer?: string }).asset_issuer || null,
        balance: b.balance,
      };
    });
  } catch (error) {
    console.error("Failed to fetch account balances:", error);
    return [];
  }
}
