"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useWallet } from "@/lib/wallet-context";
import { connectWalletConnect } from "@/lib/wallet-walletconnect";
import { QRCodeSVG } from "qrcode.react";
import { Spinner } from "./ui/Spinner";

interface WalletSelectorProps {
  networkPassphrase: string;
  onConnected: () => void;
}

export default function WalletSelector({
  networkPassphrase,
  onConnected,
}: WalletSelectorProps) {
  const t = useTranslations("walletSelector");
  const { providers, activeProvider, selectProvider } = useWallet();

  const [providerAvailability, setProviderAvailability] = useState<
    Record<string, boolean>
  >({});
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wcPairing, setWcPairing] = useState(false);
  const [wcError, setWcError] = useState<string | null>(null);

  // Check which providers are available on mount
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      providers.map(async (p) => {
        const ok = await p.isAvailable();
        return [p.id, ok] as const;
      }),
    ).then((entries) => {
      if (!cancelled) {
        setProviderAvailability(Object.fromEntries(entries));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [providers]);

  // If the active provider is already selected, nothing to show
  if (activeProvider) return null;

  async function handleSelect(id: string) {
    if (id === "walletconnect") {
      setWcError(null);
      setWcPairing(true);
      try {
        const { uri, approval } = await connectWalletConnect(networkPassphrase);
        setWcUri(uri);
        await approval;
        selectProvider("walletconnect");
        onConnected();
      } catch (err) {
        setWcError(err instanceof Error ? err.message : t("pairingFailed"));
      } finally {
        setWcPairing(false);
        setWcUri(null);
      }
      return;
    }

    selectProvider(id);
    onConnected();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-center text-sm font-medium text-slate-300">
        {t("chooseWallet")}
      </p>

      <div className="flex flex-col gap-2">
        {providers.map((p) => {
          const available = providerAvailability[p.id] ?? false;
          const isWc = p.id === "walletconnect";

          return (
            <button
              key={p.id}
              type="button"
              disabled={!available || wcPairing}
              onClick={() => handleSelect(p.id)}
              className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 font-semibold text-white transition-all hover:border-mint/50 hover:bg-mint/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isWc && wcPairing ? (
                <span className="flex items-center gap-2 text-sm">
                  <Spinner size="sm" />
                  {t("walletConnectWaiting")}
                </span>
              ) : (
                <>
                  {p.name}
                  {!available && (
                    <span className="text-xs text-slate-500">
                      {isWc ? t("noProjectId") : t("notInstalled")}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* WalletConnect QR code */}
      {wcUri && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-6">
          <p className="text-xs font-medium text-slate-400">{t("scanTitle")}</p>
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={wcUri} size={200} level="M" />
          </div>
        </div>
      )}

      {wcError && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-center text-sm text-red-400">
          {wcError}
        </p>
      )}
    </div>
  );
}
