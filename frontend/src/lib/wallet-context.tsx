"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type { WalletProvider } from "./wallet-types";
import { freighterProvider } from "./wallet-freighter";
import { walletConnectProvider } from "./wallet-walletconnect";

interface WalletContextValue {
  /** All registered wallet providers. */
  providers: WalletProvider[];

  /** The currently selected provider (null until user picks one). */
  activeProvider: WalletProvider | null;

  /** Select a provider by its id. */
  selectProvider: (id: string) => void;

  /** Clear the active provider (disconnect). */
  clearProvider: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletContextProvider({ children }: { children: ReactNode }) {
  const providers = useMemo<WalletProvider[]>(
    () => [freighterProvider, walletConnectProvider],
    [],
  );

  const [activeProvider, setActiveProvider] = useState<WalletProvider | null>(null);

  const selectProvider = useCallback(
    (id: string) => {
      const p = providers.find((prov) => prov.id === id) ?? null;
      setActiveProvider(p);
    },
    [providers],
  );

  const clearProvider = useCallback(async () => {
    if (activeProvider?.disconnect) {
      await activeProvider.disconnect();
    }
    setActiveProvider(null);
  }, [activeProvider]);

  const value = useMemo<WalletContextValue>(
    () => ({ providers, activeProvider, selectProvider, clearProvider }),
    [providers, activeProvider, selectProvider, clearProvider],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within a <WalletContextProvider>");
  }
  return ctx;
}
