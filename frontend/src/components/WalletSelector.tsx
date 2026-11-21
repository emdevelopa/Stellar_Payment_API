"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useWallet } from "@/lib/wallet-context";
import { connectWalletConnect } from "@/lib/wallet-walletconnect";
import { QRCodeSVG } from "qrcode.react";

interface WalletSelectorProps {
  networkPassphrase: string;
  onConnected: () => void;
}

/**
 * Inline multi-wallet connection panel (Freighter, xBull, Albedo, WalletConnect).
 *
 * Checkout and payment detail render this in place of a separate dialog, so it
 * stays in the page tab order instead of trapping focus. Connection failures are
 * mapped to localized copy — raw wallet errors and pairing URIs are never shown
 * as text. A dropped network rolls the in-progress choice back and shows a
 * localized toast; the toast never includes the raw error.
 */
export const WALLET_NETWORK_TOAST_ID = "wallet-selector-network-failure";

const NETWORK_FAILURE =
  /failed to fetch|fetch failed|network ?error|network ?request|network ?failure|socket|timeout|timed out|econn|enotfound|eai_again|\boffline\b|\bdns\b|net::|load failed|err_network|err_internet_disconnected|gateway timeout|bad gateway/;

function isRejection(message: string): boolean {
  return (
    message.includes("4001") ||
    message.includes("reject") ||
    message.includes("declin") ||
    message.includes("denied") ||
    message.includes("canceled") ||
    message.includes("cancelled")
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "");
}

/** Transport failures only. A user cancellation is never reported as a network failure. */
export function isWalletNetworkFailure(err: unknown): boolean {
  const normalized = errorText(err).toLowerCase();
  if (isRejection(normalized)) return false;
  return NETWORK_FAILURE.test(normalized);
}

const SUBTITLE_KEYS: Record<string, string> = {
  freighter: "subtitleFreighter",
  xbull: "subtitleXbull",
  albedo: "subtitleAlbedo",
  walletconnect: "subtitleWalletConnect",
};

function FreighterIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="#7B61FF" />
      <path
        d="M8 16h16M16 8l8 8-8 8"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function XBullIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="#F5A623" />
      <path
        d="M9 22 L16 8 L23 22"
        stroke="#0A0A0A"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.2 16.5h7.6" stroke="#0A0A0A" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function AlbedoIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="#111827" />
      <circle cx="16" cy="16" r="6.5" stroke="white" strokeWidth="2" />
      <circle cx="16" cy="16" r="2" fill="white" />
    </svg>
  );
}

function WalletConnectIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="#3B99FC" />
      <path
        d="M9.5 13.5c3.6-3.5 9.4-3.5 13 0l.4.4a.4.4 0 010 .6l-1.5 1.4a.2.2 0 01-.3 0l-.6-.6c-2.5-2.4-6.5-2.4-9 0l-.6.6a.2.2 0 01-.3 0L9 14.5a.4.4 0 010-.6l.5-.4zm16 3 1.3 1.3a.4.4 0 010 .6l-6 5.8a.4.4 0 01-.6 0l-4.2-4.1a.1.1 0 00-.2 0l-4.2 4.1a.4.4 0 01-.6 0l-6-5.8a.4.4 0 010-.6L6.5 16.5a.4.4 0 01.6 0l4.2 4.1c.1.1.1.1.2 0l4.2-4.1a.4.4 0 01.6 0l4.2 4.1c.1.1.1.1.2 0l4.2-4.1a.4.4 0 01.6 0z"
        fill="white"
      />
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  freighter: <FreighterIcon />,
  xbull: <XBullIcon />,
  albedo: <AlbedoIcon />,
  walletconnect: <WalletConnectIcon />,
};

function GenericWalletIcon() {
  return (
    <svg
      className="h-5 w-5 text-slate-500"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
      />
    </svg>
  );
}

function ConnectingSpinner() {
  return (
    <svg
      className="h-4 w-4 shrink-0 animate-spin text-[var(--pluto-500)] motion-reduce:animate-none"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function useCompactViewport() {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return compact;
}

export default function WalletSelector({
  networkPassphrase,
  onConnected,
}: WalletSelectorProps) {
  const t = useTranslations("walletSelector");
  const { providers, activeProvider, selectProvider } = useWallet();
  // Stable ids: checkout mounts one panel, and snapshot output stays deterministic.
  const headingId = "wallet-selector-title";
  const descriptionId = "wallet-selector-description";
  const listRef = useRef<HTMLUListElement>(null);
  const mountedRef = useRef(true);
  const connectingRef = useRef<string | null>(null);
  const compact = useCompactViewport();

  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [connecting, setConnecting] = useState<string | null>(null);
  const [optimisticId, setOptimisticId] = useState<string | null>(null);
  const [rolledBackId, setRolledBackId] = useState<string | null>(null);
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wcError, setWcError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      providers.map(async (provider) => {
        try {
          const ok = await provider.isAvailable();
          return [provider.id, ok] as const;
        } catch {
          return [provider.id, false] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled && mountedRef.current) {
        setInstalled(Object.fromEntries(entries));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [providers]);

  if (activeProvider) return null;

  function getFriendlyErrorMessage(id: string, err: unknown) {
    const message = err instanceof Error ? err.message : String(err ?? "");
    const normalized = message.toLowerCase();

    if (
      normalized.includes("4001") ||
      normalized.includes("reject") ||
      normalized.includes("declin") ||
      normalized.includes("denied") ||
      normalized.includes("canceled") ||
      normalized.includes("cancelled")
    ) {
      return t("userRejected");
    }

    if (
      normalized.includes("project_id") ||
      normalized.includes("project id") ||
      normalized.includes("walletconnect is disabled") ||
      normalized.includes("pairing uri")
    ) {
      return t("walletConnectUnavailable");
    }

    if (
      normalized.includes("not installed") ||
      normalized.includes("not found") ||
      normalized.includes("extension")
    ) {
      return t("extensionNotFound");
    }

    if (
      normalized.includes("no stellar accounts") ||
      normalized.includes("public key") ||
      normalized.includes("session not established")
    ) {
      return t("noAccountFound");
    }

    return id === "walletconnect" ? t("walletConnectFailed") : t("connectionFailed");
  }

  function statusCopy(id: string, isWalletConnect: boolean, isInstalled: boolean, isChecking: boolean) {
    if (rolledBackId === id) return t("reverted");
    if (isChecking) return t("checkingAvailability");
    if (!isInstalled) return isWalletConnect ? t("noProjectId") : t("notInstalled");
    const subtitleKey = SUBTITLE_KEYS[id];
    return subtitleKey ? t(subtitleKey) : t("tapToConnect");
  }

  function publishError(id: string, message: string) {
    if (id === "walletconnect") {
      setWcError(message);
      setConnectError(null);
      setWcUri(null);
      return;
    }
    setConnectError(message);
    setWcError(null);
  }

  async function handleSelect(id: string) {
    if (!mountedRef.current || connectingRef.current) return;
    if (installed[id] !== true) return;

    connectingRef.current = id;
    toast.dismiss(WALLET_NETWORK_TOAST_ID);
    setConnectError(null);
    setWcError(null);
    setWcUri(null);
    setRolledBackId(null);
    setOptimisticId(id);
    setConnecting(id);

    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await Promise.resolve();
        throw new Error("offline");
      }

      if (id === "walletconnect") {
        const { uri, approval } = await connectWalletConnect(networkPassphrase);
        if (!mountedRef.current) return;
        setWcUri(uri);
        await approval;
        if (!mountedRef.current) return;
        setWcUri(null);
        setRolledBackId(null);
        selectProvider("walletconnect");
        onConnected();
        return;
      }

      const provider = providers.find((candidate) => candidate.id === id);
      if (!provider) throw new Error("Wallet provider not found");
      await provider.getPublicKey();
      if (!mountedRef.current) return;
      setRolledBackId(null);
      selectProvider(id);
      onConnected();
    } catch (err) {
      if (!mountedRef.current) return;
      if (isWalletNetworkFailure(err)) {
        setOptimisticId((current) => (current === id ? null : current));
        setConnecting((current) => (current === id ? null : current));
        setWcUri(null);
        setRolledBackId(id);
        const message = t("networkFailure");
        publishError(id, message);
        toast.error(message, {
          id: WALLET_NETWORK_TOAST_ID,
          description: t("networkFailureHint"),
        });
        return;
      }

      setOptimisticId((current) => (current === id ? null : current));
      setRolledBackId(null);
      publishError(id, getFriendlyErrorMessage(id, err));
    } finally {
      connectingRef.current = null;
      if (mountedRef.current) {
        setConnecting((current) => (current === id ? null : current));
        setOptimisticId((current) => (current === id ? null : current));
      }
    }
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const key = event.key;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;

    const options = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-wallet-option]:not([disabled])",
      ) ?? [],
    );
    if (options.length === 0) return;

    const current = options.findIndex((option) => option === document.activeElement);
    if (current === -1 && key !== "Home" && key !== "End") return;

    event.preventDefault();
    if (key === "Home") {
      options[0]?.focus();
      return;
    }
    if (key === "End") {
      options[options.length - 1]?.focus();
      return;
    }
    const delta = key === "ArrowDown" ? 1 : -1;
    const next = (current + delta + options.length) % options.length;
    options[next]?.focus();
  }

  const errorMessage = wcError || connectError;
  const qrSize = compact ? 160 : 200;

  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      aria-busy={connecting !== null ? true : undefined}
      data-testid="wallet-selector"
      data-viewport={compact ? "compact" : "regular"}
      className="flex w-full max-w-full flex-col gap-4"
    >
      <div>
        <p id={headingId} className="text-sm font-bold text-[#0A0A0A] sm:text-base">
          {t("chooseWallet")}
        </p>
        <p id={descriptionId} className="mt-0.5 text-xs font-medium leading-relaxed text-[#6B6B6B] sm:text-sm">
          {t("description")}
        </p>
      </div>

      <ul
        ref={listRef}
        aria-label={t("walletListLabel")}
        className="flex w-full flex-col gap-2 sm:gap-3"
        onKeyDown={handleListKeyDown}
      >
        {providers.map((provider) => {
          const isWalletConnect = provider.id === "walletconnect";
          const isConnecting = connecting === provider.id;
          const isOptimistic = optimisticId === provider.id;
          const isRolledBack = rolledBackId === provider.id && !isConnecting;
          const availability = installed[provider.id];
          const isChecking = availability === undefined;
          const isInstalled = availability === true;
          const isBlocked = connecting !== null && !isConnecting;
          const state = isConnecting
            ? "connecting"
            : isChecking
              ? "checking"
              : isRolledBack
                ? "rolled-back"
                : isInstalled
                  ? "ready"
                  : "unavailable";
          const statusId = `${headingId}-${provider.id}-status`;
          const statusText = statusCopy(provider.id, isWalletConnect, isInstalled, isChecking);

          return (
            <li key={provider.id} className="min-w-0">
              <button
                type="button"
                data-wallet-option="true"
                data-testid={`wallet-option-${provider.id}`}
                data-state={state}
                data-optimistic={isOptimistic ? "true" : undefined}
                data-rolled-back={isRolledBack ? "true" : undefined}
                disabled={isBlocked}
                aria-disabled={isBlocked || !isInstalled ? true : undefined}
                aria-busy={isConnecting ? true : undefined}
                aria-pressed={isOptimistic ? true : undefined}
                aria-describedby={isConnecting ? undefined : statusId}
                onClick={() => handleSelect(provider.id)}
                className="group relative flex min-h-16 w-full touch-manipulation items-center gap-3 rounded-2xl border border-[#E8E8E8] bg-white px-4 text-left shadow-sm transition-[border-color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-white motion-reduce:transition-none data-[state=ready]:hover:-translate-y-px data-[state=ready]:hover:border-[var(--pluto-400)] data-[state=ready]:hover:shadow-[0_6px_22px_rgba(74,111,165,0.12)] data-[state=ready]:active:translate-y-0 data-[state=ready]:active:scale-[0.99] motion-reduce:data-[state=ready]:hover:translate-y-0 data-[state=unavailable]:cursor-not-allowed data-[state=unavailable]:opacity-60 data-[state=checking]:cursor-progress data-[state=checking]:opacity-80 data-[optimistic=true]:border-[var(--pluto-400)] data-[optimistic=true]:shadow-[0_8px_24px_rgba(74,111,165,0.16)] data-[state=rolled-back]:border-red-300 data-[state=rolled-back]:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 sm:gap-4 sm:px-5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] transition-colors duration-200 group-hover:border-[var(--pluto-200)] group-hover:bg-[var(--pluto-50)] motion-reduce:transition-none">
                  {ICONS[provider.id] ?? <GenericWalletIcon />}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {isConnecting ? (
                    <span className="flex items-center gap-2 text-sm font-bold text-[#0A0A0A]">
                      <ConnectingSpinner />
                      <span id={statusId}>
                        {isWalletConnect ? t("walletConnectWaiting") : t("connecting")}
                      </span>
                    </span>
                  ) : (
                    <>
                      <span className="truncate text-sm font-bold text-[#0A0A0A] transition-colors group-hover:text-[var(--pluto-600)]">
                        {provider.name}
                      </span>
                      <span id={statusId} className="text-xs font-medium leading-relaxed text-[#6B6B6B]">
                        {statusText}
                      </span>
                    </>
                  )}
                </div>

                {state === "ready" && (
                  <svg
                    className="h-4 w-4 shrink-0 text-[#C0C0C0] transition-colors duration-200 group-hover:text-[var(--pluto-500)] motion-reduce:transition-none"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {wcUri && (
        <div
          className="flex w-full flex-col items-center gap-3 rounded-2xl border border-[#E8E8E8] bg-[#F9F9F9] p-4 sm:p-6"
          aria-live="polite"
          data-testid="wallet-connect-qr"
        >
          <p className="text-center text-xs font-bold uppercase tracking-widest text-[#6B6B6B]">
            {t("scanTitle")}
          </p>
          <div
            role="img"
            aria-label={t("qrLabel")}
            className="w-full max-w-[200px] rounded-xl border border-[#E8E8E8] bg-white p-3 shadow-[0_4px_20px_rgba(0,0,0,0.05)]"
          >
            <QRCodeSVG
              value={wcUri}
              size={qrSize}
              level="M"
              fgColor="#0A0A0A"
              bgColor="#ffffff"
              aria-hidden="true"
              focusable="false"
              className="mx-auto h-auto w-full"
            />
          </div>
          <p className="max-w-xs text-center text-xs font-medium leading-relaxed text-[#6B6B6B]">
            {t("scanDescription")}
          </p>
        </div>
      )}

      {errorMessage && (
        <div
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-center text-sm font-medium leading-relaxed text-red-800"
          role="alert"
          aria-live="assertive"
          data-testid="wallet-selector-error"
        >
          {errorMessage}
        </div>
      )}

      {installed.freighter === false && (
        <a
          href="https://freighter.app"
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          data-testid="wallet-install-freighter"
          aria-label={`${t("installFreighter")} ${t("opensNewTab")}`}
          className="rounded-sm text-center text-[10px] font-bold uppercase tracking-widest text-[var(--pluto-500)] underline decoration-[var(--pluto-200)] underline-offset-4 transition-colors duration-150 hover:text-[var(--pluto-700)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-300)] focus-visible:ring-offset-2"
        >
          {t("installFreighter")}
          <span aria-hidden="true"> →</span>
        </a>
      )}
    </section>
  );
}
