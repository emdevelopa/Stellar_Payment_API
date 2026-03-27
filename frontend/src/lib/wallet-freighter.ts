import type { WalletProvider } from "./wallet-types";
import {
  isFreighterAvailable,
  getFreighterPublicKey,
  signWithFreighter,
} from "./freighter";

/**
 * WalletProvider adapter for the Freighter browser extension.
 */
export const freighterProvider: WalletProvider = {
  name: "Freighter",
  id: "freighter",

  isAvailable: () => isFreighterAvailable(),

  getPublicKey: () => getFreighterPublicKey(),

  async signTransaction(xdr: string, networkPassphrase: string): Promise<string> {
    const { signedXDR } = await signWithFreighter(xdr, networkPassphrase);
    return signedXDR;
  },
};
