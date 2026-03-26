/**
 * Unified wallet provider interface.
 *
 * Every Stellar wallet adapter (Freighter, WalletConnect, etc.) implements
 * this contract so the rest of the app stays provider-agnostic.
 */
export interface WalletProvider {
  /** Human-readable label shown in the wallet selector UI. */
  readonly name: string;

  /** Unique slug used as a stable key (e.g. "freighter", "walletconnect"). */
  readonly id: string;

  /** Whether this provider is currently usable (extension installed, session alive, etc.). */
  isAvailable(): Promise<boolean>;

  /** Return the user's Stellar public key (G…). */
  getPublicKey(): Promise<string>;

  /**
   * Sign a transaction XDR envelope.
   * Returns the signed XDR string ready for submission.
   */
  signTransaction(
    xdr: string,
    networkPassphrase: string,
  ): Promise<string>;

  /** Optional cleanup when the provider is deselected or the page unmounts. */
  disconnect?(): Promise<void>;
}
