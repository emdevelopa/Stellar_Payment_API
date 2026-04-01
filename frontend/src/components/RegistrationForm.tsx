"use client";

import Link from "next/link";
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
      <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="rounded-[3rem] border border-[#E8E8E8] bg-white p-12 shadow-[0_20px_60px_rgb(0,0,0,0.05)]">
          <div className="flex flex-col gap-4 text-center sm:text-left mb-8">
            <p className="font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">
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

        <Link
          href="/"
          className="text-center text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] transition-colors underline underline-offset-8 hover:text-[#0A0A0A]"
        >
          Enter Dashboard
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8" noValidate>
      {error && (
        <div className="rounded-2xl border border-red-100 bg-red-50 p-5 text-xs font-bold text-red-600">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="businessName"
            className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest"
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
            className={`rounded-2xl border bg-[#F9F9F9] p-4 text-sm font-bold text-[#0A0A0A] placeholder-[#A0A0A0] transition-all focus:bg-white focus:outline-none ${
              businessNameError 
                ? "border-red-500/50 focus:border-red-500" 
                : "border-[#E8E8E8] focus:border-[#0A0A0A]"
            }`}
            placeholder="PLUTO Merchant"
          />
          {businessNameError && (
            <p id="business-name-error" className="text-[10px] font-bold text-red-500 uppercase tracking-widest" role="alert">
              {businessNameError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="email"
            className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest"
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
            className={`rounded-2xl border bg-[#F9F9F9] p-4 text-sm font-bold text-[#0A0A0A] placeholder-[#A0A0A0] transition-all focus:bg-white focus:outline-none ${
              emailError 
                ? "border-red-500/50 focus:border-red-500" 
                : "border-[#E8E8E8] focus:border-[#0A0A0A]"
            }`}
            placeholder="owner@business.com"
          />
          {emailError && (
            <p id="primary-email-error" className="text-[10px] font-bold text-red-500 uppercase tracking-widest" role="alert">
              {emailError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="password"
            className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest"
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
            className={`rounded-2xl border bg-[#F9F9F9] p-4 text-sm font-bold text-[#0A0A0A] placeholder-[#A0A0A0] transition-all focus:bg-white focus:outline-none ${
              passwordError 
                ? "border-red-500/50 focus:border-red-500" 
                : "border-[#E8E8E8] focus:border-[#0A0A0A]"
            }`}
            placeholder="••••••••"
          />
          <div className="mt-1 flex flex-col gap-2">
            <div className="flex h-1 gap-1">
              {[0, 1, 2, 3].map((index) => {
                const score = passwordScore;
                const activeBars = score === 0 ? 1 : score === 4 ? 4 : score + 1;
                const isActive = password.length > 0 && index < activeBars;
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
            {password.length > 0 && (
              <p className="text-[9px] text-[#6B6B6B] text-right font-black uppercase tracking-widest">
                {["Weak", "Fair", "Good", "Strong", "Strong"][passwordScore]}
              </p>
            )}
          </div>
          {passwordError && (
            <p id="password-error" className="text-[10px] font-bold text-red-500 uppercase tracking-widest" role="alert">
              {passwordError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="notificationEmail"
            className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest"
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
            className={`rounded-2xl border bg-[#F9F9F9] p-4 text-sm font-bold text-[#0A0A0A] placeholder-[#A0A0A0] transition-all focus:bg-white focus:outline-none ${
              notificationEmailError 
                ? "border-red-500/50 focus:border-red-500" 
                : "border-[#E8E8E8] focus:border-[#0A0A0A]"
            }`}
            placeholder="alerts@business.com"
          />
          {notificationEmailError && (
            <p
              id="notification-email-error"
              className="text-[10px] font-bold text-red-500 uppercase tracking-widest"
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
        className="group relative flex h-16 items-center justify-center rounded-2xl bg-[#0A0A0A] px-8 text-[10px] font-bold uppercase tracking-[0.3em] text-white transition-all hover:bg-black shadow-xl shadow-black/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <span className="flex items-center gap-3">
            <Spinner size="sm" className="text-white" />
            Initializing Account...
          </span>
        ) : (
          "Create Professional Profile"
        )}
      </button>
    </form>
  );
}
