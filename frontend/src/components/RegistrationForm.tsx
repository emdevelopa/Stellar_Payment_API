"use client";

import React, { useState, useCallback, useMemo } from "react";
import { registerMerchant, type Merchant as AuthMerchant } from "../lib/auth";
import { toast } from "sonner";
import MaskedValue from "./MaskedValue";
import zxcvbn from "zxcvbn";
import {
  useSetMerchantApiKey,
  useSetMerchantMetadata,
  useSetMerchantToken,
} from "@/lib/merchant-store";
import { Spinner } from "./ui/Spinner";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BUSINESS_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\s&'.,-]{1,79}$/;
const FIELD_BASE_CLASSES =
  "rounded-2xl border bg-[#F9F9F9] p-4 text-sm font-bold text-[#0A0A0A] placeholder-[#A0A0A0] transition-all duration-200 focus:bg-white focus:outline-none motion-safe:hover:-translate-y-0.5";
const FIELD_THEME_CLASSES =
  "border-[#E8E8E8] hover:border-pluto-300 hover:bg-white hover:shadow-[0_14px_30px_rgba(13,27,46,0.06)] focus:border-pluto-500 focus:shadow-[0_0_0_1px_rgba(74,111,165,0.18),0_18px_36px_rgba(13,27,46,0.08)]";
const FIELD_ERROR_CLASSES =
  "border-red-500/50 hover:border-red-400 focus:border-red-500 focus:shadow-[0_0_0_1px_rgba(239,68,68,0.16),0_16px_32px_rgba(239,68,68,0.08)]";

// Memoized password strength indicator to prevent unnecessary re-renders
const PasswordStrengthIndicator = React.memo(
  ({ score, passwordLength }: { score: number; passwordLength: number }) => {
    const labels = ["Weak", "Fair", "Good", "Strong", "Strong"];
    const currentLabel = labels[score];

    return (
      <div className="mt-1 flex flex-col gap-2">
        <div
          className="flex h-1 gap-1"
          role="progressbar"
          aria-valuenow={passwordLength > 0 ? score + 1 : 0}
          aria-valuemin={0}
          aria-valuemax={4}
          aria-label={`Password strength: ${passwordLength > 0 ? currentLabel : "None"}`}
        >
          {[0, 1, 2, 3].map((index) => {
            const activeBars = score === 0 ? 1 : score === 4 ? 4 : score + 1;
            const isActive = passwordLength > 0 && index < activeBars;
            let bgColor = "bg-[#E8E8E8]";

            if (isActive) {
              if (score <= 1) bgColor = "bg-red-400";
              else if (score === 2) bgColor = "bg-yellow-400";
              else bgColor = "bg-[#0A0A0A]";
            }

            return (
              <div
                key={index}
                className={`flex-1 rounded-full transition-colors duration-300 ${bgColor}`}
              />
            );
          })}
        </div>
        {passwordLength > 0 && (
          <p
            className="text-[10px] text-[#6B6B6B] text-right font-black uppercase tracking-widest"
            aria-live="polite"
          >
            {currentLabel}
          </p>
        )}
      </div>
    );
  },
);

PasswordStrengthIndicator.displayName = "PasswordStrengthIndicator";

const RegistrationForm = React.memo(function RegistrationForm() {
  const setToken = useSetMerchantToken();
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
  const [registeredMerchant, setRegisteredMerchant] =
    useState<AuthMerchant | null>(null);

  const businessNameTrimmed = businessName.trim();
  const emailTrimmed = email.trim();
  const notificationEmailTrimmed = notificationEmail.trim();
  const passwordScore = password ? zxcvbn(password).score : 0;

  const validateBusinessName = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "Business name is required.";
    if (!BUSINESS_NAME_REGEX.test(trimmed)) {
      return "Use 2-80 characters (letters, numbers, spaces, and & ' . , -).";
    }
    return null;
  }, []);

  const validateEmail = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "Email is required.";
    if (!EMAIL_REGEX.test(trimmed)) return "Enter a valid email address.";
    return null;
  }, []);

  const validatePassword = useCallback((value: string) => {
    if (!value) return "Password is required.";
    if (value.length < 8) return "Password must be at least 8 characters.";
    if (zxcvbn(value).score < 2) {
      return "Use a stronger password with mixed characters.";
    }
    return null;
  }, []);

  const isFormValid = useMemo(
    () =>
      !businessNameError &&
      !emailError &&
      !notificationEmailError &&
      !passwordError &&
      businessNameTrimmed.length > 0 &&
      emailTrimmed.length > 0 &&
      notificationEmailTrimmed.length > 0 &&
      password.length > 0,
    [
      businessNameError,
      emailError,
      notificationEmailError,
      passwordError,
      businessNameTrimmed,
      emailTrimmed,
      notificationEmailTrimmed,
      password,
    ],
  );

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
        password,
      );

      // Auto-login logic
      if (data.token) {
        setToken(data.token);
      }

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
      <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="rounded-[3rem] border border-[#E8E8E8] bg-white p-12 shadow-[0_20px_60px_rgb(0,0,0,0.05)]">
          <div className="flex flex-col gap-4 text-center sm:text-left mb-8">
            <p className="font-bold text-xs uppercase tracking-[0.4em] text-[#6B6B6B]">
              Success
            </p>
            <h2 className="text-4xl font-bold text-[#0A0A0A] font-serif tracking-tight uppercase">
              Welcome, {registeredMerchant.business_name}
            </h2>
            <p className="text-sm font-medium text-[#6B6B6B] leading-relaxed">
              Your merchant account is ready. Save your API key below—you
              won&apos;t be able to access it again.
            </p>
          </div>

          <div className="space-y-4">
            <MaskedValue
              label="Your API Key"
              value={registeredMerchant.api_key}
              copyText={registeredMerchant.api_key}
              defaultRevealed={true}
            />
            <MaskedValue
              label="Webhook Secret"
              value={registeredMerchant.webhook_secret}
              copyText={registeredMerchant.webhook_secret}
              defaultRevealed={true}
            />
          </div>
        </div>

        <a
          href="/dashboard"
          className="text-center text-xs font-bold uppercase tracking-widest text-[#6B6B6B] underline underline-offset-8 decoration-[#B8D4E8] transition-colors duration-200 hover:text-pluto-600 focus-visible:text-pluto-700"
        >
          Enter Dashboard
        </a>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-8"
      noValidate
      aria-busy={loading}
    >
      {error && (
        <div
          className="rounded-2xl border border-red-100 bg-red-50 p-5 text-xs font-bold text-red-600"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="businessName"
            className="text-xs font-bold text-[#6B6B6B] uppercase tracking-widest"
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
            aria-describedby={
              businessNameError ? "business-name-error" : undefined
            }
            className={`${FIELD_BASE_CLASSES} ${
              businessNameError
                ? FIELD_ERROR_CLASSES
                : FIELD_THEME_CLASSES
            }`}
            placeholder="PLUTO Merchant"
          />
          {businessNameError && (
            <p
              id="business-name-error"
              className="text-xs font-bold text-red-500 uppercase tracking-widest"
              role="alert"
            >
              {businessNameError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="email"
            className="text-xs font-bold text-[#6B6B6B] uppercase tracking-widest"
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
            className={`${FIELD_BASE_CLASSES} ${
              emailError
                ? FIELD_ERROR_CLASSES
                : FIELD_THEME_CLASSES
            }`}
            placeholder="owner@business.com"
          />
          {emailError && (
            <p
              id="primary-email-error"
              className="text-xs font-bold text-red-500 uppercase tracking-widest"
              role="alert"
            >
              {emailError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="password"
            className="text-xs font-bold text-[#6B6B6B] uppercase tracking-widest"
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
            className={`${FIELD_BASE_CLASSES} ${
              passwordError
                ? FIELD_ERROR_CLASSES
                : FIELD_THEME_CLASSES
            }`}
            placeholder="••••••••"
          />
          <PasswordStrengthIndicator
            score={passwordScore}
            passwordLength={password.length}
          />
          {passwordError && (
            <p
              id="password-error"
              className="text-xs font-bold text-red-500 uppercase tracking-widest"
              role="alert"
            >
              {passwordError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="notificationEmail"
            className="text-xs font-bold text-[#6B6B6B] uppercase tracking-widest"
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
            className={`${FIELD_BASE_CLASSES} ${
              notificationEmailError
                ? FIELD_ERROR_CLASSES
                : FIELD_THEME_CLASSES
            }`}
            placeholder="alerts@business.com"
          />
          {notificationEmailError && (
            <p
              id="notification-email-error"
              className="text-xs font-bold text-red-500 uppercase tracking-widest"
              role="alert"
            >
              {notificationEmailError}
            </p>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || !isFormValid}
        className="group relative flex h-16 items-center justify-center overflow-hidden rounded-2xl bg-pluto-900 px-8 text-xs font-bold uppercase tracking-[0.3em] text-white shadow-[0_18px_40px_rgba(13,27,46,0.18)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-pluto-700 hover:shadow-[0_26px_50px_rgba(13,27,46,0.24)] focus-visible:bg-pluto-800 active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(184,212,232,0.32),transparent_58%)] opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
        {loading ? (
          <span className="relative z-10 flex items-center gap-3">
            <Spinner size="sm" className="text-white" />
            Initializing Account...
          </span>
        ) : (
          <span className="relative z-10">Create Professional Profile</span>
        )}
      </button>
    </form>
  );
});

RegistrationForm.displayName = "RegistrationForm";

export default RegistrationForm;
