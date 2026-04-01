"use client";

import { Avatar } from "@/components/ui/Avatar";
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
  const avatarName = merchant?.business_name || merchant?.email || "Merchant";
  const logoUrl = merchant?.logo_url || null;

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
        className="flex items-center gap-3 rounded-lg border border-[#E8E8E8] bg-white p-2 pr-4 transition-all hover:bg-[#F5F5F5] group"
        aria-label="Open profile menu"
      >
        <Avatar
          size={36}
          name={avatarName}
          src={logoUrl}
        />
        <div className="hidden text-left sm:block">
          <p className="truncate text-sm font-bold text-[#0A0A0A]">
            {displayName}
          </p>
          <p className="truncate text-[9px] font-bold uppercase tracking-widest text-[#6B6B6B]">{email}</p>
        </div>
        <svg
          className={`h-4 w-4 text-slate-400 transition-transform duration-300 ${
            showDropdown ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
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
          
          <div className="absolute right-0 z-50 mt-4 w-72 origin-top-right rounded-lg border border-[#E8E8E8] bg-white p-6 shadow-xl">
            {/* Profile Header */}
            <div className="mb-6 flex items-center gap-4 border-b border-[#F5F5F5] pb-6">
              <Avatar
                size={52}
                name={avatarName}
                src={logoUrl}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold text-[#0A0A0A]">
                  {displayName}
                </p>
                <p className="truncate text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest">{email}</p>
              </div>
            </div>

            {/* Menu Items */}
            <div className="flex flex-col gap-1">
              <Link
                href="/settings"
                onClick={() => setShowDropdown(false)}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest text-[#6B6B6B] transition-all hover:bg-[#F5F5F5] hover:text-[#0A0A0A]"
              >
                {/* icon svg same */}
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                Settings
              </Link>

              <Link
                href="/dashboard/create"
                onClick={() => setShowDropdown(false)}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest text-[#6B6B6B] transition-all hover:bg-[#F5F5F5] hover:text-[#0A0A0A]"
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
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                Create Payment
              </Link>

              <button
                onClick={handleLogout}
                className="mt-2 flex items-center gap-3 rounded-md bg-red-50 px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest text-red-600 transition-all hover:bg-red-100"
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
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                Logout Account
              </button>
            </div>

            {/* Network Info */}
            <div className="mt-6 rounded-lg border border-[#E8E8E8] bg-[#F9F9F9] p-4">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                Partner Since
              </p>
              <p className="mt-1 text-xs font-bold text-[#0A0A0A]">
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
