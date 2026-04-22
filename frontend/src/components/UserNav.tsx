"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { 
  useMerchantMetadata, 
  useMerchantLogout 
} from "@/lib/merchant-store";
import { useRouter } from "next/navigation";

export default function UserNav() {
  const [open, setOpen] = useState(false);
  const merchant = useMerchantMetadata();
  const logout = useMerchantLogout();
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  if (!merchant) return null;

  const initials = merchant.business_name
    ? merchant.business_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : merchant.email[0].toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 rounded-full border border-[#E8E8E8] bg-white p-1 pr-4 transition-all hover:border-[#0A0A0A] hover:shadow-sm active:scale-[0.98]"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0A0A0A] text-[10px] font-bold text-white uppercase tracking-tighter">
          {initials}
        </div>
        <div className="hidden flex-col items-start text-left sm:flex">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A]">
            {merchant.business_name}
          </span>
          <span className="text-[9px] font-medium text-[#6B6B6B]">
            {merchant.email}
          </span>
        </div>
      </button>

      {open && (
        <div className="absolute right-0 mt-3 w-56 origin-top-right rounded-2xl border border-[#E8E8E8] bg-white p-2 shadow-2xl animate-in fade-in zoom-in-95 duration-200 z-50">
          <div className="px-3 py-2 border-b border-[#F5F5F5] mb-1 sm:hidden">
             <p className="text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] truncate">{merchant.business_name}</p>
             <p className="text-[9px] font-medium text-[#6B6B6B] truncate">{merchant.email}</p>
          </div>
          
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] bg-[#F5F5F5] transition-all hover:bg-[#E8E8E8]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            Dashboard
          </Link>
          
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] transition-colors hover:bg-[#F9F9F9] hover:text-[#0A0A0A]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            Account Settings
          </Link>
          
          <Link
            href="/support"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] transition-colors hover:bg-[#F9F9F9] hover:text-[#0A0A0A]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Support Center
          </Link>

          <div className="my-1 h-px bg-[#F5F5F5]" />

          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-red-600 transition-colors hover:bg-red-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
