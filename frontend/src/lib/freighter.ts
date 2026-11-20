import type { Transaction, FeeBumpTransaction } from "stellar-sdk";

// Heavy dependencies are loaded on first use so they stay out of the initial
// bundle for pages that never touch the wallet bridge.
const loadFreighter = () => import("@stellar/freighter-api");
const loadStellarSdk = () => import("stellar-sdk");

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

// ── Accessibility helpers (WCAG 2.1 AA) ──────────────────────────────────────

/** Screen reader labels for each wallet bridge state. */
export const FREIGHTER_A11Y_LABELS = {
  connecting: "Connecting to Freighter wallet. Approve the request in the Freighter popup.",
  connected: "Freighter wallet connected.",
  signing: "Waiting for your signature in the Freighter popup.",
  signed: "Transaction signed.",
  failed: "Freighter request failed.",
} as const;

const LIVE_REGION_ID = "freighter-a11y-live-region";

/**
 * Announce a status message to assistive technology through a visually hidden
 * polite live region (WCAG 4.1.3 Status Messages). No-op outside the browser.
 */
export function announceWalletStatus(
  message: string,
  politeness: "polite" | "assertive" = "polite",
): void {
  if (typeof document === "undefined") return;
  let region = document.getElementById(LIVE_REGION_ID);
  if (!region) {
    region = document.createElement("div");
    region.id = LIVE_REGION_ID;
    region.setAttribute("role", "status");
    region.setAttribute("aria-atomic", "true");
    region.style.cssText =
      "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;";
    document.body.appendChild(region);
  }
  region.setAttribute("aria-live", politeness);
  // Clear first so repeating the same message is still announced.
  region.textContent = "";
  region.textContent = message;
}

/**
 * Run a wallet action and return keyboard focus to the element that started
 * it. The Freighter popup steals focus, so without this keyboard users land
 * on <body> afterwards (WCAG 2.4.3 Focus Order).
 */
export async function withFocusRestore<T>(action: () => Promise<T>): Promise<T> {
  const origin =
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  try {
    return await action();
  } finally {
    if (origin && origin.isConnected && origin !== document.body) {
      origin.focus();
    }
  }
}

/**
 * Check if Freighter wallet is installed (not just allowed).
 * We check for installation separately from permission so the button
 * is enabled even before the user has granted access.
 */
export async function isFreighterInstalled(): Promise<boolean> {
  try {
    const freighter = await loadFreighter();
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
  announceWalletStatus(FREIGHTER_A11Y_LABELS.connecting);
  try {
    const key = await withFocusRestore(fetchFreighterPublicKey);
    announceWalletStatus(FREIGHTER_A11Y_LABELS.connected);
    return key;
  } catch (err) {
    announceWalletStatus(
      `${FREIGHTER_A11Y_LABELS.failed} ${err instanceof Error ? err.message : ""}`.trim(),
      "assertive",
    );
    throw err;
  }
}

async function fetchFreighterPublicKey(): Promise<string> {
  const available = await isFreighterAvailable();
  if (!available) {
    throw new TransactionSignerError(
      "Freighter wallet is not installed or has not granted access.",
      "WALLET_UNAVAILABLE",
    );
  }

  try {
    const freighter = await loadFreighter();
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

  announceWalletStatus(FREIGHTER_A11Y_LABELS.signing);
  try {
    const freighter = await loadFreighter();
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
    announceWalletStatus(FREIGHTER_A11Y_LABELS.signed);
    return { signedXDR, publicKey };
  } catch (err) {
    const typed = err instanceof TransactionSignerError ? err : classifyFreighterError(err);
    announceWalletStatus(`${FREIGHTER_A11Y_LABELS.failed} ${typed.message}`, "assertive");
    throw typed;
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

  const StellarSdk = await loadStellarSdk();
  let signedTx: Transaction | FeeBumpTransaction;
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

/**
 * Run an optimistic UI update and undo it if the async action fails.
 * `apply` runs immediately, `rollback` runs when `action` rejects, and
 * `onError` receives a typed error so callers can show a toast.
 * The original error is rethrown after rollback.
 */
export async function withOptimisticRollback<T>(
  apply: () => void,
  rollback: () => void,
  action: () => Promise<T>,
  onError?: (err: TransactionSignerError) => void,
): Promise<T> {
  apply();
  try {
    return await action();
  } catch (err) {
    rollback();
    const typed =
      err instanceof TransactionSignerError
        ? err
        : new TransactionSignerError(
            err instanceof Error ? err.message : String(err),
            "UNKNOWN",
            err,
          );
    onError?.(typed);
    throw typed;
  }
}

/** Short, user-facing toast text for each signer error code. */
export function describeSignerError(err: TransactionSignerError): string {
  switch (err.code) {
    case "USER_REJECTED":
      return "Request cancelled. Nothing was signed.";
    case "WALLET_UNAVAILABLE":
      return "Freighter was not found. Install or unlock the extension.";
    case "NETWORK_MISMATCH":
      return "Freighter is on a different network than this app.";
    case "SUBMISSION_FAILED":
      return "Network error while submitting. Your change was reverted.";
    default:
      return "Wallet request failed. Your change was reverted.";
  }
}
