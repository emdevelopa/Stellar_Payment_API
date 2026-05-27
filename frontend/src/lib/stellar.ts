type StellarModule = typeof import("stellar-sdk");

let sdk: StellarModule | null = null;

async function getSdk(): Promise<StellarModule> {
  if (!sdk) {
    sdk = await import("stellar-sdk");
  }
  return sdk;
}

/* -------------------------------------------------- */
/* Types */
/* -------------------------------------------------- */

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
  path: Array<{
    asset_code: string;
    asset_issuer: string | null;
  }>;
  memo?: string | null;
  memoType?: string | null;
  horizonUrl: string;
  networkPassphrase: string;
}

export interface AssetBalance {
  code: string;
  issuer: string | null;
  balance: string;
}

/* -------------------------------------------------- */
/* Helpers */
/* -------------------------------------------------- */

export async function resolveAsset(
  assetCode: string,
  assetIssuer: string | null
) {
  const StellarSdk = await getSdk();

  if (assetCode === "XLM" || assetCode === "native") {
    return StellarSdk.Asset.native();
  }

  if (!assetIssuer) {
    throw new Error("Asset issuer required");
  }

  return new StellarSdk.Asset(assetCode, assetIssuer);
}

async function resolveMemo(
  memo: string | null | undefined,
  memoType: string | null | undefined
) {
  if (!memo || !memoType) return undefined;

  const StellarSdk = await getSdk();

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

/* -------------------------------------------------- */
/* Payments */
/* -------------------------------------------------- */

export async function buildPaymentTransaction(
  params: PaymentTransactionParams
): Promise<string> {
  const StellarSdk = await getSdk();

  const server = new StellarSdk.Horizon.Server(params.horizonUrl);
  const sourceAccount = await server.loadAccount(params.sourcePublicKey);

  const asset = await resolveAsset(
    params.assetCode,
    params.assetIssuer
  );

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  }).addOperation(
    StellarSdk.Operation.payment({
      destination: params.destinationPublicKey,
      asset,
      amount: params.amount,
    })
  );

  const memo = await resolveMemo(
    params.memo,
    params.memoType
  );

  if (memo) tx.addMemo(memo);

  return tx.setTimeout(300).build().toXDR();
}

export async function buildPathPaymentTransaction(
  params: PathPaymentTransactionParams
): Promise<string> {
  const StellarSdk = await getSdk();

  const server = new StellarSdk.Horizon.Server(params.horizonUrl);
  const sourceAccount = await server.loadAccount(
    params.sourcePublicKey
  );

  const sendAsset = await resolveAsset(
    params.sendAssetCode,
    params.sendAssetIssuer
  );

  const destAsset = await resolveAsset(
    params.destAssetCode,
    params.destAssetIssuer
  );

  const path = await Promise.all(
    params.path.map((p) =>
      resolveAsset(p.asset_code, p.asset_issuer)
    )
  );

  const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  }).addOperation(
    StellarSdk.Operation.pathPaymentStrictReceive({
      sendAsset,
      sendMax: params.sendMax,
      destination: params.destinationPublicKey,
      destAsset,
      destAmount: params.destAmount,
      path,
    })
  );

  const memo = await resolveMemo(
    params.memo,
    params.memoType
  );

  if (memo) tx.addMemo(memo);

  return tx.setTimeout(300).build().toXDR();
}

/* -------------------------------------------------- */
/* Anchor */
/* -------------------------------------------------- */

export async function getAnchorServices(domain: string) {
  const StellarSdk = await getSdk();

  const toml =
    await StellarSdk.StellarToml.Resolver.resolve(domain);

  return {
    transferServer:
      toml.TRANSFER_SERVER_SEP0024 ||
      toml.TRANSFER_SERVER,
    webAuthEndpoint: toml.WEB_AUTH_ENDPOINT,
    signingKey: toml.SIGNING_KEY,
  };
}

export async function authenticateWithAnchor(
  account: string,
  authEndpoint: string,
  signTransaction: (xdr: string) => Promise<string>
): Promise<string> {
  const challengeRes = await fetch(
    `${authEndpoint}?account=${account}`
  );

  const challengeData = await challengeRes.json();

  if (!challengeData.transaction) {
    throw new Error("No challenge tx");
  }

  const signedXDR = await signTransaction(
    challengeData.transaction
  );

  const loginRes = await fetch(authEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transaction: signedXDR,
    }),
  });

  const loginData = await loginRes.json();

  if (!loginData.token) {
    throw new Error("No JWT returned");
  }

  return loginData.token;
}

export async function initiateWithdrawal(
  transferServer: string,
  jwt: string,
  assetCode: string,
  account: string
): Promise<string> {
  const formData = new FormData();

  formData.append("asset_code", assetCode);
  formData.append("account", account);

  const res = await fetch(
    `${transferServer}/transactions/withdraw/interactive`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
      body: formData,
    }
  );

  const data = await res.json();

  if (!data.url) {
    throw new Error("No withdrawal URL");
  }

  return data.url;
}

/* -------------------------------------------------- */
/* Balances */
/* -------------------------------------------------- */

export async function getAccountBalances(
  publicKey: string,
  horizonUrl: string
): Promise<AssetBalance[]> {
  try {
    const StellarSdk = await getSdk();

    const server =
      new StellarSdk.Horizon.Server(horizonUrl);

    const account =
      await server.loadAccount(publicKey);

    return account.balances.map((b) => {
      if (b.asset_type === "native") {
        return {
          code: "XLM",
          issuer: null,
          balance: b.balance,
        };
      }

      return {
        code:
          (b as { asset_code?: string })
            .asset_code || "UNKNOWN",
        issuer:
          (b as { asset_issuer?: string })
            .asset_issuer || null,
        balance: b.balance,
      };
    });
  } catch {
    return [];
  }
}