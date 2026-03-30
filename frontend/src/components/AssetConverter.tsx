"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import * as StellarSdk from "stellar-sdk";
import { useWallet } from "@/lib/wallet-context";
import { resolveAsset } from "@/lib/stellar";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PathRecord {
  destination_amount: string;
  source_amount: string;
  path: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>;
}

interface QuoteResult {
  sourceAsset: string;
  sourceAmount: string;
  destAsset: string;
  destAmount: string;
  rate: string;
  path: string[];
  queriedAt: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

const SLIPPAGE = 0.01;

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function SwapIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M19 12H5m0 0 5-5m-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M21 12a9 9 0 1 1-2.6-6.36" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatAssetLabel(code: string, issuer: string | null): string {
  if (!issuer || code.toUpperCase() === "XLM") return code.toUpperCase();
  return `${code.toUpperCase()}:${issuer.slice(0, 4)}…${issuer.slice(-4)}`;
}

function formatPathHop(asset: { asset_type: string; asset_code?: string; asset_issuer?: string }): string {
  if (asset.asset_type === "native") return "XLM";
  return asset.asset_code?.toUpperCase() ?? "?";
}

function isValidAssetCode(code: string): boolean {
  return /^[a-zA-Z0-9]{1,12}$/.test(code);
}

function isValidStellarAddress(addr: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(addr);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface AssetConverterProps {
  onBack: () => void;
}

export default function AssetConverter({ onBack }: AssetConverterProps) {
  const { activeProvider } = useWallet();
  const firstInputRef = useRef<HTMLInputElement>(null);

  // From fields
  const [fromCode, setFromCode] = useState("XLM");
  const [fromIssuer, setFromIssuer] = useState("");
  const [amount, setAmount] = useState("");

  // To fields
  const [toCode, setToCode] = useState("USDC");
  const [toIssuer, setToIssuer] = useState(
    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  );

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteResult | null>(null);

  // Focus first input on mount
  useEffect(() => {
    requestAnimationFrame(() => firstInputRef.current?.focus());
  }, []);

  /* ---------- staleness timer ---------- */
  const [secondsAgo, setSecondsAgo] = useState(0);
  useEffect(() => {
    if (!result) return;
    setSecondsAgo(0);
    const id = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - result.queriedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [result]);

  /* ---------- validation ---------- */
  function validate(): string | null {
    if (!activeProvider) return "Connect a wallet to query paths";
    if (!fromCode.trim()) return "Enter source asset code";
    if (!isValidAssetCode(fromCode.trim())) return "Invalid source asset code (1-12 alphanumeric)";
    if (fromCode.toUpperCase() !== "XLM" && !fromIssuer.trim()) return "Issuer address required for non-native source asset";
    if (fromCode.toUpperCase() !== "XLM" && fromIssuer.trim() && !isValidStellarAddress(fromIssuer.trim())) return "Invalid source issuer address";
    if (!toCode.trim()) return "Enter destination asset code";
    if (!isValidAssetCode(toCode.trim())) return "Invalid destination asset code (1-12 alphanumeric)";
    if (toCode.toUpperCase() !== "XLM" && !toIssuer.trim()) return "Issuer address required for non-native destination asset";
    if (toCode.toUpperCase() !== "XLM" && toIssuer.trim() && !isValidStellarAddress(toIssuer.trim())) return "Invalid destination issuer address";
    if (!amount.trim() || isNaN(Number(amount)) || Number(amount) <= 0) return "Enter a valid positive amount";
    if (fromCode.toUpperCase() === toCode.toUpperCase() && (fromIssuer || "") === (toIssuer || "")) return "Source and destination assets must be different";
    return null;
  }

  /* ---------- query Horizon ---------- */
  const convert = useCallback(async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const server = new StellarSdk.Horizon.Server(HORIZON_URL);

      const sourceAsset = resolveAsset(
        fromCode.trim().toUpperCase(),
        fromCode.toUpperCase() === "XLM" ? null : fromIssuer.trim(),
      );
      const destAsset = resolveAsset(
        toCode.trim().toUpperCase(),
        toCode.toUpperCase() === "XLM" ? null : toIssuer.trim(),
      );

      const response = await server
        .strictSendPaths(sourceAsset, amount.trim(), [destAsset])
        .call();

      const records = response.records as PathRecord[];

      if (!records || records.length === 0) {
        setError("No conversion path available for this asset pair");
        return;
      }

      // Pick the best path (highest destination amount)
      const best = records.reduce((a, b) =>
        Number(b.destination_amount) > Number(a.destination_amount) ? b : a,
      );

      const srcAmt = Number(best.source_amount);
      const dstAmt = Number(best.destination_amount);
      const rate = srcAmt > 0 ? (dstAmt / srcAmt).toFixed(7) : "0";

      const pathLabels = [
        formatAssetLabel(fromCode, fromCode.toUpperCase() === "XLM" ? null : fromIssuer),
        ...best.path.map(formatPathHop),
        formatAssetLabel(toCode, toCode.toUpperCase() === "XLM" ? null : toIssuer),
      ];

      setResult({
        sourceAsset: formatAssetLabel(fromCode, fromCode.toUpperCase() === "XLM" ? null : fromIssuer),
        sourceAmount: best.source_amount,
        destAsset: formatAssetLabel(toCode, toCode.toUpperCase() === "XLM" ? null : toIssuer),
        destAmount: best.destination_amount,
        rate,
        path: pathLabels,
        queriedAt: Date.now(),
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) {
        setError("No conversion path available for this asset pair");
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Horizon unavailable. Try again.",
        );
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvider, fromCode, fromIssuer, toCode, toIssuer, amount]);

  /* ---------- swap ---------- */
  function handleSwap() {
    setFromCode(toCode);
    setFromIssuer(toIssuer);
    setToCode(fromCode);
    setToIssuer(fromIssuer);
    setResult(null);
    setError(null);
  }

  /* ---------- keyboard ---------- */
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !loading) {
      e.preventDefault();
      convert();
    }
  }

  const isNativeFrom = fromCode.toUpperCase() === "XLM";
  const isNativeTo = toCode.toUpperCase() === "XLM";

  return (
    <div onKeyDown={handleKeyDown}>
      {/* ── Header ── */}
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Back to commands"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-mint" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M2 17 12 7l10 10" strokeLinecap="round" strokeLinejoin="round" opacity={0.4} />
            <path d="M2 12 12 2l10 10" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sm font-semibold text-white">Asset Converter</span>
        </div>
        <kbd className="ml-auto hidden rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 sm:inline-block">
          ESC
        </kbd>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-col gap-4 p-4">

        {/* FROM */}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            From
          </legend>
          <div className="flex gap-2">
            <input
              ref={firstInputRef}
              type="text"
              value={fromCode}
              onChange={(e) => {
                setFromCode(e.target.value.toUpperCase().slice(0, 12));
                setResult(null);
              }}
              placeholder="XLM"
              className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-mint focus:ring-1 focus:ring-mint"
              aria-label="Source asset code"
            />
            {!isNativeFrom && (
              <input
                type="text"
                value={fromIssuer}
                onChange={(e) => {
                  setFromIssuer(e.target.value);
                  setResult(null);
                }}
                placeholder="Issuer G…"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white placeholder-slate-600 outline-none transition-colors focus:border-mint focus:ring-1 focus:ring-mint"
                aria-label="Source asset issuer"
              />
            )}
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^\d*\.?\d*$/.test(v)) {
                setAmount(v);
                setResult(null);
              }
            }}
            placeholder="Amount"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-mint focus:ring-1 focus:ring-mint"
            aria-label="Amount to convert"
          />
        </fieldset>

        {/* SWAP */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleSwap}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-400 transition-all hover:border-mint/30 hover:bg-mint/10 hover:text-mint"
            aria-label="Swap assets"
          >
            <SwapIcon className="h-4 w-4" />
          </button>
        </div>

        {/* TO */}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            To
          </legend>
          <div className="flex gap-2">
            <input
              type="text"
              value={toCode}
              onChange={(e) => {
                setToCode(e.target.value.toUpperCase().slice(0, 12));
                setResult(null);
              }}
              placeholder="USDC"
              className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-mint focus:ring-1 focus:ring-mint"
              aria-label="Destination asset code"
            />
            {!isNativeTo && (
              <input
                type="text"
                value={toIssuer}
                onChange={(e) => {
                  setToIssuer(e.target.value);
                  setResult(null);
                }}
                placeholder="Issuer G…"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white placeholder-slate-600 outline-none transition-colors focus:border-mint focus:ring-1 focus:ring-mint"
                aria-label="Destination asset issuer"
              />
            )}
          </div>
        </fieldset>

        {/* CONVERT BUTTON */}
        <button
          type="button"
          onClick={convert}
          disabled={loading || !activeProvider}
          className="group relative flex h-10 w-full items-center justify-center rounded-lg font-semibold text-black transition-all disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: "var(--color-mint)" }}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <SpinnerIcon className="h-4 w-4 animate-spin" />
              Querying…
            </span>
          ) : (
            "Convert"
          )}
          <div className="absolute inset-0 -z-10 rounded-lg opacity-0 blur-xl transition-opacity group-hover:opacity-100" style={{ backgroundColor: "color-mix(in srgb, var(--color-mint) 25%, transparent)" }} />
        </button>

        {/* ERROR */}
        {error && (
          <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* RESULT */}
        {result && (
          <div className="flex flex-col gap-2.5 rounded-lg border border-mint/20 bg-mint/5 p-3">
            {/* Rate headline */}
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Rate
              </span>
              <span className="font-mono text-sm font-bold text-white">
                1 {result.sourceAsset} ≈ {result.rate} {result.destAsset}
              </span>
            </div>

            {/* You send */}
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-slate-400">You send</span>
              <span className="font-mono text-sm text-white">
                {result.sourceAmount} {result.sourceAsset}
              </span>
            </div>

            {/* You receive */}
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-slate-400">You receive</span>
              <span className="font-mono text-sm font-bold text-mint">
                {result.destAmount} {result.destAsset}
              </span>
            </div>

            {/* Slippage */}
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-slate-400">Slippage buffer</span>
              <span className="font-mono text-xs text-slate-400">
                ≤ {(Number(result.sourceAmount) * (1 + SLIPPAGE)).toFixed(7)} {result.sourceAsset} ({(SLIPPAGE * 100).toFixed(0)}%)
              </span>
            </div>

            {/* Path */}
            {result.path.length > 2 && (
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-slate-400">Path</span>
                <span className="font-mono text-xs text-slate-300">
                  {result.path.join(" → ")}
                </span>
              </div>
            )}

            {/* Staleness + refresh */}
            <div className="flex items-center justify-between border-t border-white/5 pt-2">
              <span className="text-[11px] text-slate-500">
                Quoted {secondsAgo}s ago
              </span>
              <button
                type="button"
                onClick={convert}
                disabled={loading}
                className="flex items-center gap-1 text-[11px] text-mint transition-colors hover:text-glow disabled:opacity-50"
              >
                <RefreshIcon className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center gap-4 border-t border-white/10 px-4 py-2">
        <span className="flex items-center gap-1 text-[11px] text-slate-500">
          <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px]">
            ↵
          </kbd>
          convert
        </span>
        <span className="flex items-center gap-1 text-[11px] text-slate-500">
          <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px]">
            esc
          </kbd>
          back
        </span>
        {!activeProvider && (
          <span className="ml-auto text-[11px] text-amber-400/80">
            Wallet not connected
          </span>
        )}
      </div>
    </div>
  );
}
