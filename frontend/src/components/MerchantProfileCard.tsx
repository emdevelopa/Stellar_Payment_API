"use client";

import Avatar from "boring-avatars";
import Link from "next/link";
import {
  useMerchantMetadata,
  useMerchantLogout,
  useMerchantHydrated,
  useHydrateMerchantStore,
} from "@/lib/merchant-store";
import { useState } from "react";

export default function MerchantProfileCard() {
  const merchant = useMerchantMetadata();
  const logout = useMerchantLogout();
  const hydrated = useMerchantHydrated();
  const [showDropdown, setShowDropdown] = useState(false);

  useHydrateMerchantStore();

  if (!hydrated) return null;

  // If no merchant data, show anonymous profile
  const displayName = merchant?.business_name || merchant?.email || "Merchant";
  const email = merchant?.email || "";
  const avatarSeed = email || "anonymous";

  const handleLogout = () => {
    logout();
    setShowDropdown(false);
    window.location.href = "/";
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowDropdown((v) => !v)}
        className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-2 pr-3 transition-all hover:bg-white/10"
        aria-label="Open profile menu"
      >
        <Avatar
          size={36}
          name={avatarSeed}
          variant="beam"
          colors={["#5ef2c0", "#b8ffe2", "#0f1a2b", "#0b0c10", "#ffffff"]}
          square={false}
        />
        <div className="hidden text-left sm:block">
          <p className="truncate text-sm font-medium text-white">
            {displayName}
          </p>
          <p className="truncate text-xs text-slate-400">{email}</p>
        </div>
        <svg
          className={`h-4 w-4 text-slate-400 transition-transform ${
            showDropdown ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {showDropdown && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowDropdown(false)}
          />
          
          <div className="absolute right-0 z-50 mt-2 w-64 origin-top-right rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-2xl backdrop-blur">
            {/* Profile Header */}
            <div className="mb-4 flex items-center gap-3 border-b border-white/10 pb-4">
              <Avatar
                size={48}
                name={avatarSeed}
                variant="beam"
                colors={[
                  "#5ef2c0",
                  "#b8ffe2",
                  "#0f1a2b",
                  "#0b0c10",
                  "#ffffff",
                ]}
                square={false}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {displayName}
                </p>
                <p className="truncate text-xs text-slate-400">{email}</p>
              </div>
            </div>

            {/* Menu Items */}
            <div className="flex flex-col gap-1">
              <Link
                href="/settings"
                onClick={() => setShowDropdown(false)}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-300 transition-all hover:bg-white/10 hover:text-white"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                Settings
              </Link>

              <Link
                href="/dashboard/create"
                onClick={() => setShowDropdown(false)}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-300 transition-all hover:bg-white/10 hover:text-white"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                Create Payment
              </Link>

              <button
                onClick={handleLogout}
                className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400 transition-all hover:border-red-500/50 hover:bg-red-500/20"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                Logout
              </button>
            </div>

            {/* Network Info */}
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Merchant Since
              </p>
              <p className="mt-1 text-xs text-slate-300">
                {merchant?.created_at
                  ? new Date(merchant.created_at).toLocaleDateString()
                  : "N/A"}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
