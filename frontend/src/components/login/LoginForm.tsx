"use client";

import Link from "next/link";
import { useState } from "react";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Login submitted", { email, password, rememberMe });
  };

  return (
    <div className="w-full max-w-[440px] rounded-2xl bg-[#0f1623] p-8 sm:p-10 shadow-2xl relative z-10">
      <div className="mb-8">
        <h2 className="text-[26px] font-bold tracking-tight text-white mb-2">Welcome Back</h2>
        <p className="text-[13px] text-slate-400">Please enter your credentials to access your Stellar account.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
            Email Address
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-transparent bg-[#161d2a] py-3.5 pl-11 pr-4 text-[13px] text-white placeholder-slate-500 transition-colors focus:border-mint/30 focus:bg-[#1a2333] focus:outline-none focus:ring-1 focus:ring-mint/30"
              placeholder="name@company.com"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
            Password
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-transparent bg-[#161d2a] py-3.5 pl-11 pr-4 text-[13px] text-white placeholder-slate-500 transition-colors focus:border-mint/30 focus:bg-[#1a2333] focus:outline-none focus:ring-1 focus:ring-mint/30"
              placeholder="••••••••"
            />
          </div>
        </div>

        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-2 cursor-pointer">
            <input
              id="remember_me"
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-gray-600 bg-transparent text-mint focus:ring-mint focus:ring-offset-0 cursor-pointer"
            />
            <label htmlFor="remember_me" className="text-[13px] text-slate-300 cursor-pointer select-none">
              Remember me
            </label>
          </div>
          <Link href="/forgot-password" className="text-[13px] font-medium text-mint hover:text-glow transition-colors">
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          className="mt-4 flex w-full justify-center rounded-xl bg-mint py-3.5 text-[14px] font-bold text-[#0b0c10] shadow-[0_0_15px_rgba(94,242,192,0.25)] transition-all hover:brightness-110 active:scale-[0.98]"
        >
          Login to Account
        </button>
      </form>

      <p className="mt-8 text-center text-[13px] text-slate-400">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-semibold text-mint hover:text-glow transition-colors">
          Sign up
        </Link>
      </p>
    </div>
  );
}
