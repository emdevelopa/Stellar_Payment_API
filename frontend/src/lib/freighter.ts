import * as StellarSdk from "stellar-sdk";
import * as freighter from "@stellar/freighter-api";

export interface FreighterSignResponse {
  signedXDR: string;
  publicKey: string;
}

export type SignerErrorCode =
  | "WALLET_UNAVAILABLE"
  | "USER_REJECTED"
  | "INVALID_XDR"
  | "NETWORK_MISMATCH"
  | "SUBMISSION_FAILED"
  | "PUBLIC_KEY_FETCH_FAILED"
  | "UNKNOWN";

export class TransactionSignerError extends Error {
  constructor(
    message: string,
    public readonly code: SignerErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TransactionSignerError";
  }
}

function classifyFreighterError(err: unknown): TransactionSignerError {
  const msg = err instanceof Error ? err.message : String(err);

  if (/user declined|user rejected|cancelled/i.test(msg)) {
    return new TransactionSignerError(
      "User rejected the signing request in Freighter.",
      "USER_REJECTED",
      err,
    );
  }
  if (/network|passphrase/i.test(msg)) {
    return new TransactionSignerError(
      "Network passphrase mismatch between app and Freighter wallet.",
      "NETWORK_MISMATCH",
      err,
    );
  }
  if (/xdr|transaction/i.test(msg)) {
    return new TransactionSignerError(
      `Invalid transaction XDR: ${msg}`,
      "INVALID_XDR",
      err,
    );
  }
  return new TransactionSignerError(
    `Freighter error: ${msg}`,
    "UNKNOWN",
    err,
  );
}

/**
 * Check if Freighter wallet is installed (not just allowed).
 * We check for installation separately from permission so the button
 * is enabled even before the user has granted access.
 */
export async function isFreighterInstalled(): Promise<boolean> {
  try {
    const result = await freighter.isConnected();
    // isConnected returns boolean or { isConnected: boolean }
    if (typeof result === "boolean") return result;
    return (result as { isConnected: boolean })?.isConnected ?? false;
  } catch {
    return false;
  }
}

/**
 * Check if Freighter wallet is available and allowed.
 */
export async function isFreighterAvailable(): Promise<boolean> {
  return isFreighterInstalled();
}

/**
 * Get the public key from Freighter wallet.
 * Calls setAllowed() first which triggers the Freighter permission popup.
 * Throws a typed TransactionSignerError on any failure.
 */
export async function getFreighterPublicKey(): Promise<string> {
  const available = await isFreighterAvailable();
  if (!available) {
    throw new TransactionSignerError(
      "Freighter wallet is not installed or has not granted access.",
      "WALLET_UNAVAILABLE",
    );
  }

  try {
    // setAllowed() triggers the Freighter popup asking user to approve the site
    const allowed = await freighter.setAllowed();
    if (!allowed) {
      throw new TransactionSignerError(
        "User denied Freighter access.",
        "USER_REJECTED",
      );
    }

    const result = await freighter.getPublicKey();
    // getPublicKey returns string or { publicKey: string, error?: string }
    if (typeof result === "string") {
      if (!result) throw new Error("No public key returned");
      return result;
    }
    const obj = result as { publicKey?: string; error?: string };
    if (obj.error) throw new Error(obj.error);
    if (!obj.publicKey) throw new Error("No public key returned from Freighter");
    return obj.publicKey;
  } catch (err) {
    if (err instanceof TransactionSignerError) throw err;
    throw new TransactionSignerError(
      `Failed to retrieve public key from Freighter wallet: ${err instanceof Error ? err.message : String(err)}`,
      "PUBLIC_KEY_FETCH_FAILED",
      err,
    );
  }
}

/**
 * Sign a transaction XDR with Freighter, surfacing typed errors so callers
 * can handle user-rejected vs network-mismatch vs unknown failures distinctly.
 */
export async function signWithFreighter(
  transactionXDR: string,
  networkPassphrase: string,
): Promise<FreighterSignResponse> {
  if (!transactionXDR) {
    throw new TransactionSignerError(
      "transactionXDR must not be empty.",
      "INVALID_XDR",
    );
  }

  const available = await isFreighterAvailable();
  if (!available) {
    throw new TransactionSignerError(
      "Freighter wallet is not installed or has not granted access.",
      "WALLET_UNAVAILABLE",
    );
  }

  try {
    const result = await freighter.signTransaction(transactionXDR, {
      networkPassphrase,
    });

    // Handle both string return (old API) and object return (new API)
    let signedXDR: string;
    if (typeof result === "string") {
      signedXDR = result;
    } else {
      const obj = result as { signedTxXdr?: string; signedXDR?: string; error?: string };
      if (obj.error) throw new Error(obj.error);
      signedXDR = obj.signedTxXdr ?? obj.signedXDR ?? "";
    }

    if (!signedXDR) throw new Error("No signed XDR returned from Freighter");

    const publicKey = await getFreighterPublicKey();
    return { signedXDR, publicKey };
  } catch (err) {
    if (err instanceof TransactionSignerError) throw err;
    throw classifyFreighterError(err);
  }
}

/**
 * Submit a signed transaction to the Stellar network with structured error
 * reporting on Horizon failures.
 */
export async function submitTransaction(
  signedXDR: string,
  horizonUrl: string,
  networkPassphrase: string,
): Promise<{ hash: string }> {
  if (!signedXDR) {
    throw new TransactionSignerError(
      "signedXDR must not be empty.",
      "INVALID_XDR",
    );
  }

  let signedTx: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction;
  try {
    signedTx = StellarSdk.TransactionBuilder.fromXDR(signedXDR, networkPassphrase);
  } catch (err) {
    throw new TransactionSignerError(
      `Cannot parse signed XDR: ${err instanceof Error ? err.message : String(err)}`,
      "INVALID_XDR",
      err,
    );
  }

  try {
    const server = new StellarSdk.Horizon.Server(horizonUrl);
    const result = await server.submitTransaction(signedTx);

    if (!result.hash) {
      throw new TransactionSignerError(
        "Horizon returned a response without a transaction hash.",
        "SUBMISSION_FAILED",
      );
    }

    return { hash: result.hash };
  } catch (err) {
    if (err instanceof TransactionSignerError) throw err;

    const msg = err instanceof Error ? err.message : String(err);
    throw new TransactionSignerError(
      `Transaction submission failed: ${msg}`,
      "SUBMISSION_FAILED",
      err,
    );
  }
}
