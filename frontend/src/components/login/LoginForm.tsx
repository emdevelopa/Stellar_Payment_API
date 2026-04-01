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
    <div className="w-full max-w-[440px] rounded-[3rem] bg-white p-10 sm:p-14 shadow-[0_20px_60px_rgb(0,0,0,0.05)] border border-[#E8E8E8]">
      <div className="mb-12 text-center sm:text-left">
        <h2 className="text-4xl font-bold tracking-tight text-[#0A0A0A] mb-4 uppercase">Welcome Back</h2>
        <p className="text-sm font-medium text-[#6B6B6B]">Sign in to your professional PLUTO dashboard.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-[10px] font-bold tracking-[0.2em] text-[#6B6B6B] uppercase">
            Email Address
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[#6B6B6B]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-2xl border border-[#E8E8E8] bg-[#F9F9F9] px-5 py-4 pl-12 text-sm font-bold text-[#0A0A0A] placeholder-[#A0A0A0] transition-all focus:border-[#0A0A0A] focus:bg-white focus:outline-none"
              placeholder="name@company.com"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-[10px] font-bold tracking-[0.2em] text-[#6B6B6B] uppercase">
            Password
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[#6B6B6B]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-[#E8E8E8] bg-[#F9F9F9] px-5 py-4 pl-12 text-sm font-bold text-[#0A0A0A] placeholder-[#A0A0A0] transition-all focus:border-[#0A0A0A] focus:bg-white focus:outline-none"
              placeholder="••••••••"
            />
          </div>
        </div>

        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-2 cursor-pointer group">
            <input
              id="remember_me"
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-[#E8E8E8] text-[#0A0A0A] focus:ring-[#0A0A0A] transition-all"
            />
            <label htmlFor="remember_me" className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] group-hover:text-[#0A0A0A] transition-colors">
              Remember me
            </label>
          </div>
          <Link href="/forgot-password" className="text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] hover:underline">
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          className="mt-6 flex w-full justify-center rounded-2xl bg-[#0A0A0A] py-5 text-[10px] font-bold uppercase tracking-[0.3em] text-white shadow-xl shadow-black/10 transition-all hover:bg-black active:scale-[0.98]"
        >
          Sign in to PLUTO
        </button>
      </form>

      <p className="mt-10 text-center text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
        New to PLUTO?{" "}
        <Link href="/register" className="text-[#0A0A0A] underline underline-offset-4 hover:text-black">
          Create account
        </Link>
      </p>
    </div>
  );
}
