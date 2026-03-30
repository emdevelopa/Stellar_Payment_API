"use client";

import { useState } from "react";
import { registerMerchant, type Merchant } from "../lib/auth";
import { toast } from "sonner";
import MaskedValue from "./MaskedValue";
import zxcvbn from "zxcvbn";
import {
  useSetMerchantApiKey,
  useSetMerchantMetadata,
} from "@/lib/merchant-store";
import { Spinner } from "./ui/Spinner";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BUSINESS_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\s&'.,-]{1,79}$/;

export default function RegistrationForm() {
  const setApiKey = useSetMerchantApiKey();
  const setMerchant = useSetMerchantMetadata();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [notificationEmail, setNotificationEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businessNameError, setBusinessNameError] = useState<string | null>(
    null,
  );
  const [emailError, setEmailError] = useState<string | null>(null);
  const [notificationEmailError, setNotificationEmailError] = useState<
    string | null
  >(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [registeredMerchant, setRegisteredMerchant] = useState<Merchant | null>(
    null,
  );

  const businessNameTrimmed = businessName.trim();
  const emailTrimmed = email.trim();
  const notificationEmailTrimmed = notificationEmail.trim();
  const passwordScore = password ? zxcvbn(password).score : 0;

  const validateBusinessName = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "Business name is required.";
    if (!BUSINESS_NAME_REGEX.test(trimmed)) {
      return "Use 2-80 characters (letters, numbers, spaces, and & ' . , -).";
    }
    return null;
  };

  const validateEmail = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "Email is required.";
    if (!EMAIL_REGEX.test(trimmed)) return "Enter a valid email address.";
    return null;
  };

  const validatePassword = (value: string) => {
    if (!value) return "Password is required.";
    if (value.length < 8) return "Password must be at least 8 characters.";
    if (zxcvbn(value).score < 2) {
      return "Use a stronger password with mixed characters.";
    }
    return null;
  };

  const isFormValid =
    !businessNameError &&
    !emailError &&
    !notificationEmailError &&
    !passwordError &&
    businessNameTrimmed.length > 0 &&
    emailTrimmed.length > 0 &&
    notificationEmailTrimmed.length > 0 &&
    password.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const nextBusinessNameError = validateBusinessName(businessName);
    const nextEmailError = validateEmail(email);
    const nextNotificationEmailError = validateEmail(notificationEmail);
    const nextPasswordError = validatePassword(password);

    setBusinessNameError(nextBusinessNameError);
    setEmailError(nextEmailError);
    setNotificationEmailError(nextNotificationEmailError);
    setPasswordError(nextPasswordError);

    if (
      nextBusinessNameError ||
      nextEmailError ||
      nextNotificationEmailError ||
      nextPasswordError
    ) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await registerMerchant(
        emailTrimmed,
        businessNameTrimmed,
        notificationEmailTrimmed,
      );
      setRegisteredMerchant(data.merchant);
      setApiKey(data.merchant.api_key);
      setMerchant(data.merchant);
      toast.success("Merchant registered successfully!");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to register merchant";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (registeredMerchant) {
    return (
      <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="rounded-2xl border border-mint/30 bg-mint/5 p-6 backdrop-blur">
          <div className="flex flex-col gap-2">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-mint">
              Registration Success
            </p>
            <h2 className="text-xl font-semibold text-white">
              Welcome, {registeredMerchant.business_name}!
            </h2>
            <p className="text-sm text-slate-300">
              Your merchant account is ready. Save your API key below-you
              won&apos;t be able to see it again.
            </p>
          </div>

          <div className="mt-6">
            <MaskedValue
              label="Your API Key"
              value={registeredMerchant.api_key}
              copyText={registeredMerchant.api_key}
              defaultRevealed={true}
            />
          </div>

          <div className="mt-4">
            <MaskedValue
              label="Webhook Secret"
              value={registeredMerchant.webhook_secret}
              copyText={registeredMerchant.webhook_secret}
              defaultRevealed={true}
            />
          </div>
        </div>

        <a
          href="/"
          className="text-center text-sm font-medium text-slate-300 transition-colors underline underline-offset-4 hover:text-white"
        >
          Go to Dashboard
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="businessName"
            className="text-xs font-medium text-slate-300 uppercase tracking-wider"
          >
            Business Name
          </label>
          <input
            id="businessName"
            type="text"
            required
            value={businessName}
            onChange={(e) => {
              const nextValue = e.target.value;
              setBusinessName(nextValue);
              setBusinessNameError(validateBusinessName(nextValue));
            }}
            aria-invalid={Boolean(businessNameError)}
            aria-describedby={businessNameError ? "business-name-error" : undefined}
            className={`rounded-xl border bg-white/5 p-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 ${businessNameError ? "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/50" : "border-white/10 focus:border-mint/50 focus:ring-mint/50"}`}
            placeholder="Stellar Shop"
          />
          {businessNameError ? (
            <p id="business-name-error" className="text-xs text-red-400" role="alert">
              {businessNameError}
            </p>
          ) : businessNameTrimmed.length > 0 ? (
            <p className="text-xs text-green-400" aria-live="polite">
              Looks good.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="email"
            className="text-xs font-medium text-slate-300 uppercase tracking-wider"
          >
            Primary Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => {
              const nextValue = e.target.value;
              setEmail(nextValue);
              setEmailError(validateEmail(nextValue));
            }}
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "primary-email-error" : undefined}
            className={`rounded-xl border bg-white/5 p-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 ${emailError ? "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/50" : "border-white/10 focus:border-mint/50 focus:ring-mint/50"}`}
            placeholder="owner@business.com"
          />
          {emailError ? (
            <p id="primary-email-error" className="text-xs text-red-400" role="alert">
              {emailError}
            </p>
          ) : emailTrimmed.length > 0 ? (
            <p className="text-xs text-green-400" aria-live="polite">
              Email format looks valid.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="password"
            className="text-xs font-medium text-slate-300 uppercase tracking-wider"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => {
              const nextValue = e.target.value;
              setPassword(nextValue);
              setPasswordError(validatePassword(nextValue));
            }}
            aria-invalid={Boolean(passwordError)}
            aria-describedby={passwordError ? "password-error" : undefined}
            className={`rounded-xl border bg-white/5 p-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 ${passwordError ? "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/50" : "border-white/10 focus:border-mint/50 focus:ring-mint/50"}`}
            placeholder="********"
          />
          <div className="mt-1 flex flex-col gap-1.5">
            <div className="flex h-1.5 gap-1">
              {[0, 1, 2, 3].map((index) => {
                const score = passwordScore;
                const activeBars = score === 0 ? 1 : score === 4 ? 4 : score + 1;
                const isActive = password.length > 0 && index < activeBars;
                let bgColor = "bg-white/10";

                if (isActive) {
                  if (score === 0) bgColor = "bg-red-500";
                  else if (score === 1) bgColor = "bg-orange-500";
                  else if (score === 2) bgColor = "bg-yellow-400";
                  else if (score === 3) bgColor = "bg-lime-400";
                  else if (score === 4) bgColor = "bg-green-500";
                }

                return (
                  <div
                    key={index}
                    className={`flex-1 rounded-full transition-colors duration-300 ${bgColor}`}
                  />
                );
              })}
            </div>
            {password.length > 0 && (
              <p className="text-[10px] text-slate-300 text-right font-medium">
                {["Weak", "Fair", "Good", "Strong", "Strong"][passwordScore]}
              </p>
            )}
          </div>
          {passwordError ? (
            <p id="password-error" className="text-xs text-red-400" role="alert">
              {passwordError}
            </p>
          ) : password.length > 0 ? (
            <p className="text-xs text-green-400" aria-live="polite">
              Password strength is acceptable.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="notificationEmail"
            className="text-xs font-medium text-slate-300 uppercase tracking-wider"
          >
            Notification Email
          </label>
          <input
            id="notificationEmail"
            type="email"
            required
            value={notificationEmail}
            onChange={(e) => {
              const nextValue = e.target.value;
              setNotificationEmail(nextValue);
              setNotificationEmailError(validateEmail(nextValue));
            }}
            aria-invalid={Boolean(notificationEmailError)}
            aria-describedby={
              notificationEmailError ? "notification-email-error" : undefined
            }
            className={`rounded-xl border bg-white/5 p-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 ${notificationEmailError ? "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/50" : "border-white/10 focus:border-mint/50 focus:ring-mint/50"}`}
            placeholder="alerts@business.com"
          />
          {notificationEmailError ? (
            <p
              id="notification-email-error"
              className="text-xs text-red-400"
              role="alert"
            >
              {notificationEmailError}
            </p>
          ) : notificationEmailTrimmed.length > 0 ? (
            <p className="text-xs text-green-400" aria-live="polite">
              Notification email format looks valid.
            </p>
          ) : null}
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || !isFormValid}
        className="group relative flex h-12 items-center justify-center rounded-xl bg-mint px-6 font-bold text-black transition-all hover:bg-glow disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <Spinner size="sm" className="text-black" />
            Processing...
          </span>
        ) : (
          "Register Merchant"
        )}
        <div className="absolute inset-0 -z-10 bg-mint/20 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
      </button>
    </form>
  );
}
