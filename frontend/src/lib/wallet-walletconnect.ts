import type { WalletProvider } from "./wallet-types";

// Lazy-loaded to keep the initial bundle small
let SignClientClass: typeof import("@walletconnect/sign-client").SignClient | null = null;

/** Cached initialised client — reused across the session lifetime. */
let clientInstance: InstanceType<typeof import("@walletconnect/sign-client").SignClient> | null = null;

/**
 * Stellar chain identifiers used by WalletConnect v2.
 * @see https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md
 */
function stellarChainId(network: string): string {
  return network.includes("Public")
    ? "stellar:pubnet"
    : "stellar:testnet";
}

const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
const DISABLED_PROJECT_IDS = new Set(["", "your-project-id-here"]);

interface ActiveSession {
  client: InstanceType<typeof import("@walletconnect/sign-client").SignClient>;
  topic: string;
  publicKey: string;
  chainId: string;
}

let activeSession: ActiveSession | null = null;

function hasWalletConnectProjectId(): boolean {
  return !DISABLED_PROJECT_IDS.has(PROJECT_ID.trim());
}

/**
 * Lazy-load and initialise the WalletConnect SignClient (singleton).
 */
async function getSignClient() {
  if (!hasWalletConnectProjectId()) return null;

  if (clientInstance) return clientInstance;

  if (!SignClientClass) {
    try {
      const mod = await import("@walletconnect/sign-client");
      SignClientClass = mod.SignClient;
    } catch (err) {
      console.warn("WalletConnect disabled: SignClient could not be loaded.", err);
      return null;
    }
  }

  clientInstance = await SignClientClass.init({
    projectId: PROJECT_ID,
    metadata: {
      name: "Stellar Payment",
      description: "Pay with any Stellar wallet via WalletConnect",
      url: typeof window !== "undefined" ? window.location.origin : "",
      icons: [],
    },
  });

  return clientInstance;
}

/**
 * Start a WalletConnect pairing session.
 *
 * Returns a `uri` the caller can render as a QR code and a `Promise` that
 * resolves once the remote wallet approves the session.
 */
export async function connectWalletConnect(
  networkPassphrase: string,
): Promise<{ uri: string; approval: Promise<void> }> {
  const client = await getSignClient();
  if (!client) {
    throw new Error(
      "WalletConnect is disabled. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable it.",
    );
  }
  const chainId = stellarChainId(networkPassphrase);

  const { uri, approval: approvalPromise } = await client.connect({
    requiredNamespaces: {
      stellar: {
        methods: ["stellar_signXDR"],
        chains: [chainId],
        events: [],
      },
    },
  });

  if (!uri) throw new Error("WalletConnect did not return a pairing URI");

  const approval = approvalPromise().then((session) => {
    // Extract the first stellar account from the approved session
    const accounts = session.namespaces.stellar?.accounts ?? [];
    if (accounts.length === 0) {
      throw new Error("No Stellar accounts returned by the wallet");
    }
    // Format: stellar:testnet:<publicKey>
    const publicKey = accounts[0].split(":").pop();
    if (!publicKey) throw new Error("Failed to parse public key from session");

    activeSession = {
      client,
      topic: session.topic,
      publicKey,
      chainId,
    };
  });

  return { uri, approval };
}

/**
 * WalletProvider adapter for WalletConnect v2 (Stellar Sign API).
 */
export const walletConnectProvider: WalletProvider = {
  name: "WalletConnect",
  id: "walletconnect",

  async isAvailable(): Promise<boolean> {
    return hasWalletConnectProjectId();
  },

  async getPublicKey(): Promise<string> {
    if (!activeSession) {
      throw new Error("WalletConnect session not established. Call connectWalletConnect() first.");
    }
    return activeSession.publicKey;
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async signTransaction(xdr: string, _networkPassphrase: string): Promise<string> {
    if (!activeSession) {
      throw new Error("WalletConnect session not established");
    }

    const result = await activeSession.client.request<{ signedXDR: string }>({
      topic: activeSession.topic,
      chainId: activeSession.chainId,
      request: {
        method: "stellar_signXDR",
        params: { xdr },
      },
    });

    return result.signedXDR;
  },

  async disconnect(): Promise<void> {
    if (activeSession) {
      try {
        await activeSession.client.disconnect({
          topic: activeSession.topic,
          reason: { code: 6000, message: "User disconnected" },
        });
      } catch {
        // best-effort
      }
      activeSession = null;
      clientInstance = null;
    }
  },
};
