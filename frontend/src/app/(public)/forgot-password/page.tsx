"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import GuestGuard from "@/components/GuestGuard";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
  };

  return (
    <GuestGuard>
      <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-10 px-6 py-24 bg-white text-[#0A0A0A]">
        <header className="text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B]">
            Account Recovery
          </p>
          <h1 className="mt-4 text-5xl font-serif font-black uppercase tracking-tight">
            Reset Password
          </h1>
          <p className="mt-4 text-sm font-medium text-[#6B6B6B] leading-relaxed">
            Enter your account email to begin password recovery.
          </p>
        </header>

        <section className="rounded-[2rem] border border-[#E8E8E8] bg-white p-8 shadow-[0_20px_60px_rgb(0,0,0,0.05)]">
          {!submitted ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <label htmlFor="email" className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#6B6B6B]">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-2xl border border-[#E8E8E8] bg-[#F9F9F9] px-5 py-4 text-sm font-bold text-[#0A0A0A] placeholder-[#A0A0A0] transition-all focus:border-[#0A0A0A] focus:bg-white focus:outline-none"
                placeholder="name@company.com"
              />
              <button
                type="submit"
                className="mt-2 flex h-14 w-full items-center justify-center rounded-2xl bg-[var(--pluto-500)] text-[10px] font-bold uppercase tracking-[0.3em] text-white transition-all hover:bg-[var(--pluto-600)]"
              >
                Continue
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="rounded-2xl border border-[#DDE7DD] bg-[#F6FBF6] px-4 py-3 text-sm font-medium text-[#235B23]">
                Request received. If an account exists for {email}, recovery instructions will be sent.
              </p>
              <p className="text-xs font-medium leading-relaxed text-[#6B6B6B]">
                If you do not receive an email shortly, please contact your administrator or support channel.
              </p>
            </div>
          )}
        </section>

        <footer className="text-center text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
          Remembered your password?{" "}
          <Link href="/login" className="text-[#0A0A0A] underline underline-offset-4 hover:text-black">
            Back to login
          </Link>
        </footer>
      </main>
    </GuestGuard>
  );
}
