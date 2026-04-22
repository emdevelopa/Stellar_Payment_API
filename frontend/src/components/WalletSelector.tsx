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

// Freighter icon SVG
function FreighterIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none">
      <rect width="32" height="32" rx="8" fill="#7B61FF" />
      <path d="M8 16h16M16 8l8 8-8 8" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WalletConnectIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none">
      <rect width="32" height="32" rx="8" fill="#3B99FC" />
      <path d="M9.5 13.5c3.6-3.5 9.4-3.5 13 0l.4.4a.4.4 0 010 .6l-1.5 1.4a.2.2 0 01-.3 0l-.6-.6c-2.5-2.4-6.5-2.4-9 0l-.6.6a.2.2 0 01-.3 0L9 14.5a.4.4 0 010-.6l.5-.4zm16 3 1.3 1.3a.4.4 0 010 .6l-6 5.8a.4.4 0 01-.6 0l-4.2-4.1a.1.1 0 00-.2 0l-4.2 4.1a.4.4 0 01-.6 0l-6-5.8a.4.4 0 010-.6L6.5 16.5a.4.4 0 01.6 0l4.2 4.1c.1.1.1.1.2 0l4.2-4.1a.4.4 0 01.6 0l4.2 4.1c.1.1.1.1.2 0l4.2-4.1a.4.4 0 01.6 0z" fill="white" />
    </svg>
  );
}

export default function WalletSelector({ networkPassphrase, onConnected }: WalletSelectorProps) {
  const t = useTranslations("walletSelector");
  const { providers, activeProvider, selectProvider } = useWallet();

  // Track which wallets are installed (not just allowed)
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [connecting, setConnecting] = useState<string | null>(null);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wcError, setWcError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      providers.map(async (p) => {
        const ok = await p.isAvailable();
        return [p.id, ok] as const;
      }),
    ).then((entries) => {
      if (!cancelled) setInstalled(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [providers]);

  if (activeProvider) return null;

  async function handleSelect(id: string) {
    setConnectError(null);
    setConnecting(id);

    try {
      if (id === "walletconnect") {
        setWcError(null);
        const { uri, approval } = await connectWalletConnect(networkPassphrase);
        setWcUri(uri);
        await approval;
        setWcUri(null);
        selectProvider("walletconnect");
        onConnected();
        return;
      }

      // For Freighter — call getPublicKey directly which triggers requestAccess popup
      if (id === "freighter") {
        const provider = providers.find(p => p.id === "freighter");
        if (!provider) throw new Error("Freighter provider not found");
        // This triggers the Freighter popup
        await provider.getPublicKey();
        selectProvider(id);
        onConnected();
        return;
      }

      selectProvider(id);
      onConnected();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      if (id === "walletconnect") {
        setWcError(msg);
        setWcUri(null);
      } else {
        setConnectError(msg);
      }
    } finally {
      setConnecting(null);
    }
  }

  const ICONS: Record<string, React.ReactNode> = {
    freighter: <FreighterIcon />,
    walletconnect: <WalletConnectIcon />,
  };

  const SUBTITLES: Record<string, string> = {
    freighter: "Browser extension wallet",
    walletconnect: "Mobile & desktop wallets",
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-bold text-[#0A0A0A]">{t("chooseWallet")}</p>
        <p className="text-xs text-[#6B6B6B] mt-0.5">Connect your Stellar wallet to complete this payment.</p>
      </div>

      <div className="flex flex-col gap-3">
        {providers.map((p) => {
          const isWc = p.id === "walletconnect";
          const isConnecting = connecting === p.id;
          const isInstalled = installed[p.id] ?? false;
          // WalletConnect needs a project ID; Freighter just needs to be installed
          const isDisabled = isWc ? !isInstalled : false;

          return (
            <button
              key={p.id}
              type="button"
              disabled={isDisabled || connecting !== null}
              onClick={() => handleSelect(p.id)}
              className="group relative flex h-16 w-full items-center gap-4 rounded-2xl border border-[#E8E8E8] bg-white px-5 text-left shadow-sm transition-all hover:border-[var(--pluto-400)] hover:shadow-[0_4px_20px_rgba(74,111,165,0.12)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {/* Icon */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] transition-all group-hover:border-[var(--pluto-200)] group-hover:bg-[var(--pluto-50)]">
                {ICONS[p.id] ?? (
                  <svg className="h-5 w-5 text-[#6B6B6B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                )}
              </div>

              {/* Label */}
              <div className="flex flex-1 flex-col gap-0.5">
                {isConnecting ? (
                  <span className="flex items-center gap-2 text-sm font-bold text-[#0A0A0A]">
                    <Spinner size="sm" />
                    {isWc ? t("walletConnectWaiting") : "Connecting…"}
                  </span>
                ) : (
                  <>
                    <span className="text-sm font-bold text-[#0A0A0A]">{p.name}</span>
                    <span className="text-[10px] font-medium text-[#6B6B6B]">
                      {isDisabled
                        ? (isWc ? t("noProjectId") : t("notInstalled"))
                        : SUBTITLES[p.id] ?? "Click to connect"}
                    </span>
                  </>
                )}
              </div>

              {/* Arrow */}
              {!isConnecting && !isDisabled && (
                <svg className="h-4 w-4 shrink-0 text-[#C0C0C0] group-hover:text-[var(--pluto-500)] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {/* WalletConnect QR */}
      {wcUri && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#E8E8E8] bg-[#F9F9F9] p-6">
          <p className="text-xs font-bold uppercase tracking-widest text-[#6B6B6B]">{t("scanTitle")}</p>
          <div className="rounded-xl bg-white border border-[#E8E8E8] p-3">
            <QRCodeSVG value={wcUri} size={200} level="M" fgColor="#0A0A0A" bgColor="#ffffff" />
          </div>
          <p className="text-[10px] text-[#6B6B6B] text-center">Scan with Freighter mobile or any WalletConnect-compatible wallet</p>
        </div>
      )}

      {(wcError || connectError) && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center text-sm text-red-600">
          {wcError || connectError}
        </div>
      )}

      {/* Freighter install prompt */}
      {!installed["freighter"] && (
        <a
          href="https://freighter.app"
          target="_blank"
          rel="noopener noreferrer"
          className="text-center text-[10px] font-bold uppercase tracking-widest text-[var(--pluto-500)] hover:text-[var(--pluto-700)] transition-colors"
        >
          Don&apos;t have Freighter? Install it →
        </a>
      )}
    </div>
  );
}
