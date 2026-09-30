"use client";

import { useState, useId } from "react";
import { useTranslations } from "next-intl";
import { Spinner } from "./ui/Spinner";

// ── Types ────────────────────────────────────────────────────────────────────

type SetupStep = "idle" | "enabling" | "scan" | "verifying" | "success";

interface TwoFactorAuthSetupProps {
  /** Called once 2FA has been successfully enabled. */
  onComplete?: () => void;
  /** Callback that simulates generating a TOTP secret and returns a QR data URL. */
  onGenerateSecret?: () => Promise<{ qrDataUrl: string; manualKey: string }>;
  /** Callback that verifies the user-supplied 6-digit code. */
  onVerifyCode?: (code: string) => Promise<void>;
}

// ── Network-failure detection ───────────────────────────────────────────────

/**
 * Distinguishes a network/connectivity failure (fetch couldn't reach the
 * server at all) from a server-side rejection (e.g. wrong code). Only the
 * former should roll back optimistically without discarding in-flight setup
 * state (QR/manual key, entered code) — a rejected code is a normal retry,
 * not a connectivity problem, and clearing the QR would force a needless
 * re-scan.
 */
function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (error instanceof TypeError) return true; // fetch's own connectivity failure signature
  if (error instanceof Error) {
    return /network|fetch|offline|connection/i.test(error.message);
  }
  return false;
}

// ── Skeleton helpers ─────────────────────────────────────────────────────────

function QrSkeleton({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <div
      className="mx-auto h-48 w-48 animate-pulse rounded-xl bg-white/10"
      aria-busy="true"
      aria-label={t("qrCodeSkeletonLabel")}
      role="img"
    />
  );
}

function StepDot({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors ${
          done
            ? "border-mint bg-mint text-black"
            : active
              ? "border-mint bg-mint/20 text-mint"
              : "border-white/20 bg-white/5 text-slate-500"
        }`}
        aria-current={active ? "step" : undefined}
      >
        {done ? (
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
            <path d="M13.5 2.5L6 10 2.5 6.5 1 8l5 5 9-9-1.5-1.5z" />
          </svg>
        ) : (
          <span>{label}</span>
        )}
      </div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function TwoFactorAuthSetup({
  onComplete,
  onGenerateSecret,
  onVerifyCode,
}: TwoFactorAuthSetupProps) {
  const codeInputId = useId();
  const t = useTranslations("twoFactorAuth");
  const [step, setStep] = useState<SetupStep>("idle");
  const [code, setCode] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);

  const isEnabling = step === "enabling";
  const isVerifying = step === "verifying";
  const isBusy = isEnabling || isVerifying;

  // ── Step 1: generate secret ──────────────────────────────────────────────

  const handleEnable = async () => {
    setStep("enabling");
    setError(null);
    setIsNetworkError(false);
    try {
      const generate = onGenerateSecret ?? defaultGenerateSecret;
      const result = await generate();
      setQrDataUrl(result.qrDataUrl);
      setManualKey(result.manualKey);
      setStep("scan");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.setupFailed"));
      setIsNetworkError(isNetworkFailure(err));
      // Nothing to roll back to yet at this step — no QR/manual key has been
      // committed, so returning to idle is already the correct rollback.
      setStep("idle");
    }
  };

  // ── Step 2: verify OTP ───────────────────────────────────────────────────

  const handleVerify = async () => {
    if (code.trim().length !== 6) {
      setError(t("error.codeLength"));
      setIsNetworkError(false);
      return;
    }
    setStep("verifying");
    setError(null);
    setIsNetworkError(false);
    try {
      const verify = onVerifyCode ?? defaultVerifyCode;
      await verify(code.trim());
      setStep("success");
      onComplete?.();
    } catch (err) {
      const networkFailure = isNetworkFailure(err);
      setError(networkFailure ? t("error.networkFailure") : err instanceof Error ? err.message : t("error.invalidCode"));
      setIsNetworkError(networkFailure);
      // Optimistic rollback: return to the scan step without discarding the
      // QR/manual key already shown, or the code the user typed. A network
      // failure means the request never reached the server — clearing state
      // here would force a needless re-scan for a problem that has nothing
      // to do with the code's validity. Only a confirmed-invalid code should
      // prompt the user to re-enter it (handled by the input's own clear-on-edit).
      setStep("scan");
      if (networkFailure) {
        // Preserve the entered code so retrying doesn't require retyping it.
      } else {
        setCode("");
      }
    }
  };

  const handleRetryVerify = () => {
    if (isNetworkError) {
      void handleVerify();
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const isDone = step === "success";
  const scanVisible = step === "scan" || step === "verifying";

  return (
    <section
      aria-label={t("ariaLabel")}
      aria-busy={isBusy}
      className="flex flex-col gap-6"
    >
      {/* Progress indicator */}
      <div className="flex items-center gap-0" role="list" aria-label={t("stepsLabel")}>
        <div role="listitem">
          <StepDot active={step === "idle" || step === "enabling"} done={scanVisible || isDone} label="1" />
        </div>
        <div className="h-px flex-1 bg-white/10 mx-1" aria-hidden="true" />
        <div role="listitem">
          <StepDot active={scanVisible} done={isDone} label="2" />
        </div>
        <div className="h-px flex-1 bg-white/10 mx-1" aria-hidden="true" />
        <div role="listitem">
          <StepDot active={isDone} done={isDone} label="3" />
        </div>
      </div>
      {/* Announces step transitions to screen reader / keyboard-only users,
          who otherwise have no cue the flow advanced since the step dots
          themselves aren't focusable (there is no valid "jump back" action —
          each step is driven by an async call, not freely navigable). */}
      <p className="sr-only" role="status" aria-live="polite">
        {t("stepAnnouncement", { current: isDone ? "3" : scanVisible ? "2" : "1", total: "3" })}
      </p>

      {/* ── Idle / Enabling ──────────────────────────────────────────── */}
      {(step === "idle" || step === "enabling") && (
        <div className="flex flex-col gap-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-mint/10">
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-mint" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">{t("title")}</h3>
            <p className="mt-1 text-sm text-slate-400">
              {t("description")}
            </p>
          </div>
          <button
            type="button"
            onClick={handleEnable}
            disabled={isEnabling}
            aria-busy={isEnabling}
            className="mx-auto flex min-w-[10rem] items-center justify-center gap-2 rounded-xl bg-mint px-6 py-3 text-sm font-bold text-black transition-all hover:scale-[1.01] hover:bg-mint/90 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
          >
            {isEnabling ? (
              <>
                <Spinner size="sm" aria-hidden="true" />
                <span>{t("settingUp")}</span>
              </>
            ) : (
              t("enableButton")
            )}
          </button>
        </div>
      )}

      {/* ── Scan QR / Verifying ──────────────────────────────────────── */}
      {scanVisible && (
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="text-sm font-semibold text-white">{t("scanTitle")}</h3>
            <p className="mt-1 text-xs text-slate-400">
              {t("scanDescription")}
            </p>
          </div>

          {/* QR code */}
          <div className="flex justify-center">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={t("qrCodeAlt")}
                className="h-48 w-48 rounded-xl border border-white/10 bg-white p-2"
                width={192}
                height={192}
              />
            ) : (
              <QrSkeleton t={t} />
            )}
          </div>

          {/* Manual key fallback */}
          {manualKey && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-slate-500">{t("manualKeyLabel")}</p>
              <p className="mt-1 break-all font-mono text-xs text-mint" aria-label={t("manualKeyAria", { key: manualKey })}>
                {manualKey}
              </p>
            </div>
          )}

          {/* Code input */}
          <div className="flex flex-col gap-2">
            <label htmlFor={codeInputId} className="text-xs font-semibold text-white">
              {t("codeInputLabel")}
            </label>
            <input
              id={codeInputId}
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                setError(null);
                setIsNetworkError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isVerifying && code.length === 6) {
                  e.preventDefault();
                  void handleVerify();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setCode("");
                  setError(null);
                  setIsNetworkError(false);
                }
              }}
              disabled={isVerifying}
              aria-busy={isVerifying}
              aria-invalid={!!error && step === "scan"}
              aria-describedby={error ? "2fa-error" : undefined}
              placeholder={t("codeInputPlaceholder")}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center font-mono text-xl tracking-[0.4em] text-white placeholder:text-slate-600 focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/50 disabled:opacity-50"
            />
            {error && (
              <p id="2fa-error" role="alert" className="text-xs text-red-400">
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleVerify}
              disabled={isVerifying || code.length !== 6}
              aria-busy={isVerifying}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-mint py-3 text-sm font-bold text-black transition-all hover:scale-[1.01] hover:bg-mint/90 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
            >
              {isVerifying ? (
                <>
                  <Spinner size="sm" aria-hidden="true" />
                  <span>{t("verifying")}</span>
                </>
              ) : (
                t("verifyButton")
              )}
            </button>
            {isNetworkError && !isVerifying && (
              <button
                type="button"
                onClick={handleRetryVerify}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 py-3 text-sm font-bold text-white transition-all hover:bg-white/10 sm:w-auto sm:px-6"
              >
                {t("retryButton")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Success ──────────────────────────────────────────────────── */}
      {isDone && (
        <div className="flex flex-col items-center gap-4 py-2 text-center" role="status" aria-live="polite">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-mint/15">
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-mint" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">{t("successTitle")}</h3>
            <p className="mt-1 text-sm text-slate-400">
              {t("successDescription")}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Default async stubs (used when no props are provided) ────────────────────

async function defaultGenerateSecret(): Promise<{ qrDataUrl: string; manualKey: string }> {
  await new Promise((r) => setTimeout(r, 1000));
  const manualKey = "JBSWY3DPEHPK3PXP";
  const label = encodeURIComponent("StellarPayAPI:user@example.com");
  const issuer = encodeURIComponent("StellarPayAPI");
  const otpauth = `otpauth://totp/${label}?secret=${manualKey}&issuer=${issuer}`;
  const qrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=192x192&data=${encodeURIComponent(otpauth)}`;
  return { qrDataUrl, manualKey };
}

async function defaultVerifyCode(code: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 800));
  if (code.length !== 6) throw new Error("Code must be 6 digits.");
}

export default TwoFactorAuthSetup;
