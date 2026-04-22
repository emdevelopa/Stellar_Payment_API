import * as StellarSdk from "stellar-sdk";
import * as freighter from "@stellar/freighter-api";

export interface FreighterSignResponse {
  signedXDR: string;
  publicKey: string;
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
 * Check if Freighter wallet is available and allowed
 */
export async function isFreighterAvailable(): Promise<boolean> {
  return isFreighterInstalled();
}

/**
 * Get the public key from Freighter wallet.
 * Calls setAllowed() first which triggers the Freighter permission popup.
 */
export async function getFreighterPublicKey(): Promise<string> {
  try {
    // setAllowed() triggers the Freighter popup asking user to approve the site
    const allowed = await freighter.setAllowed();
    if (!allowed) {
      throw new Error("User denied Freighter access");
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
    throw new Error(
      `Freighter: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Sign a transaction with Freighter wallet
 */
export async function signWithFreighter(
  transactionXDR: string,
  networkPassphrase: string
): Promise<FreighterSignResponse> {
  try {
    const result = await freighter.signTransaction(transactionXDR, {
      networkPassphrase,
    });

    // Handle both string return (old) and object return (new)
    let signedXDR: string;
    if (typeof result === "string") {
      signedXDR = result;
    } else {
      const obj = result as { signedTxXdr?: string; signedXDR?: string; error?: string };
      if (obj.error) throw new Error(obj.error);
      signedXDR = obj.signedTxXdr ?? obj.signedXDR ?? "";
    }

    if (!signedXDR) throw new Error("No signed XDR returned from Freighter");

    const pkResult = await freighter.getPublicKey();
    const publicKey = typeof pkResult === "string" ? pkResult : (pkResult as { publicKey?: string })?.publicKey ?? "";

    return { signedXDR, publicKey };
  } catch (err) {
    throw new Error(
      `Freighter sign failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Submit a signed transaction to Stellar network
 */
export async function submitTransaction(
  signedXDR: string,
  horizonUrl: string,
  networkPassphrase: string
): Promise<{ hash: string }> {
  try {
    const server = new StellarSdk.Horizon.Server(horizonUrl);
    const signedTx = StellarSdk.TransactionBuilder.fromXDR(
      signedXDR,
      networkPassphrase
    );

    const result = await server.submitTransaction(signedTx);
    
    if (!result.hash) {
      throw new Error("No transaction hash returned");
    }

    return {
      hash: result.hash,
    };
  } catch (error) {
    throw new Error(
      `Failed to submit transaction: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
