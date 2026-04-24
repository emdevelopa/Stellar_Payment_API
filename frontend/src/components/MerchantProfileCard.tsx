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

  if (!merchant) {
    return (
      <Link
        href="/login"
        className="inline-flex h-10 items-center gap-2 rounded-full border border-[#E8E8E8] bg-white px-4 text-xs font-bold uppercase tracking-widest text-[#0A0A0A] transition-colors hover:bg-[#F5F5F5]"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A9 9 0 1118.879 17.804M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Account
      </Link>
    );
  }

  const displayName = merchant.business_name || merchant.email || "Merchant";
  const email = merchant.email || "";
  const avatarName = merchant.business_name || merchant.email || "Merchant";
  const logoUrl = merchant.logo_url || null;

  const handleLogout = () => {
    logout();
    setShowDropdown(false);
    window.location.href = "/login";
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowDropdown((v) => !v)}
        className="group flex h-10 items-center gap-2.5 rounded-full border border-[#E8E8E8] bg-white px-2.5 pr-3.5 transition-all hover:border-[#DADADA] hover:bg-[#F8F8F8]"
        aria-label="Open profile menu"
        aria-expanded={showDropdown}
        aria-haspopup="true"
      >
        <Avatar
          size={30}
          name={avatarName}
          src={logoUrl}
        />
        <div className="hidden max-w-[170px] text-left sm:block">
          <p className="truncate text-xs font-bold text-[#0A0A0A]">
            {displayName}
          </p>
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B6B6B]">{email}</p>
        </div>
        <svg
          className={`h-3.5 w-3.5 text-[#8A8A8A] transition-transform duration-300 ${
            showDropdown ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
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
          
          <div 
            className="absolute right-0 z-50 mt-3 w-72 origin-top-right rounded-2xl border border-[#E8E8E8] bg-white p-5 shadow-[0_20px_50px_rgba(0,0,0,0.12)]"
            role="menu"
            aria-orientation="vertical"
          >
            {/* Profile Header */}
            <div className="mb-5 flex items-center gap-3.5 border-b border-[#F0F0F0] pb-5">
              <Avatar
                size={52}
                name={avatarName}
                src={logoUrl}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold text-[#0A0A0A]">
                  {displayName}
                </p>
                <p className="truncate text-[10px] font-bold text-[#6B6B6B] uppercase tracking-[0.16em]">{email}</p>
              </div>
            </div>

            {/* Menu Items */}
            <div className="flex flex-col gap-1.5">
              <Link
                href="/dashboard"
                onClick={() => setShowDropdown(false)}
                role="menuitem"
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-widest text-[#0A0A0A] bg-[#F5F5F5] transition-all hover:bg-[#E8E8E8]"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                  />
                </svg>
                Dashboard
              </Link>

              <Link
                href="/settings"
                onClick={() => setShowDropdown(false)}
                role="menuitem"
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-widest text-[#6B6B6B] transition-all hover:bg-[#F5F5F5] hover:text-[#0A0A0A]"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
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
                role="menuitem"
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-widest text-[#6B6B6B] transition-all hover:bg-[#F5F5F5] hover:text-[#0A0A0A]"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
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
                role="menuitem"
                className="mt-2 flex items-center gap-3 rounded-xl bg-red-50 px-3 py-2.5 text-xs font-bold uppercase tracking-widest text-red-600 transition-all hover:bg-red-100"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
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
          </div>
        </>
      )}
    </div>
  );
}
