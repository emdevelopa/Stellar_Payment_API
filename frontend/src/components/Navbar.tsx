"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHydrateMerchantStore } from "@/lib/merchant-store";
import MerchantProfileCard from "@/components/MerchantProfileCard";
import ApiHealthBadge from "@/components/ApiHealthBadge";

type AppNavLink = {
  href: string;
  label: string;
};

type DashboardNavLink = {
  href: string;
  label: string;
  icon: (active: boolean) => React.ReactNode;
  enabled: boolean;
};

function CreateIcon(active: boolean) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${active ? "text-mint" : "text-slate-400"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function OverviewIcon(active: boolean) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${active ? "text-mint" : "text-slate-400"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        d="M4 5.5h16M4 12h16M4 18.5h16"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 8.5h4M13 8.5h4M7 15h4M13 15h4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PaymentsIcon(active: boolean) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${active ? "text-mint" : "text-slate-400"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <rect
        x="3.5"
        y="5.5"
        width="17"
        height="13"
        rx="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7 14h4M7 10h10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WebhooksIcon(active: boolean) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${active ? "text-mint" : "text-slate-400"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        d="M9 7.5a4 4 0 1 1 6.8 2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 16.5a4 4 0 1 1-6.8-2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 14 15.5 10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="14.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="9.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

const appNavLinks: AppNavLink[] = [
  { href: "/", label: "Home" },
  { href: "/login", label: "Login" },
  { href: "/register", label: "Register" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useHydrateMerchantStore();

  const toggleMenu = () => {
    setIsMenuOpen((prev) => !prev);
  };

  // Close on Escape and return focus to the trigger button
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMenuOpen]);

  return (
    <nav className="border-b border-white/10 bg-black/50 backdrop-blur dark:border-white/10 dark:bg-black/50">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="font-mono text-sm uppercase tracking-[0.3em] text-mint">
              Stellar Pay
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-8 md:flex">
              {appNavLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive(pathname, link.href) ? "page" : undefined}
                  className={`text-sm transition-colors ${
                    isActive(pathname, link.href)
                      ? "text-white"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {/* Mobile Menu Button */}
            <button
              ref={triggerRef}
              onClick={toggleMenu}
              className="flex flex-col gap-1.5 md:hidden p-2 text-white"
              aria-label="Toggle menu"
              aria-expanded={isMenuOpen}
              aria-controls="mobile-nav-menu"
            >
              <span
                className={`block h-0.5 w-6 bg-white transition-all ${
                  isMenuOpen ? "translate-y-2 rotate-45" : ""
                }`}
              ></span>
              <span
                className={`block h-0.5 w-6 bg-white transition-all ${
                  isMenuOpen ? "opacity-0" : ""
                }`}
              ></span>
              <span
                className={`block h-0.5 w-6 bg-white transition-all ${
                  isMenuOpen ? "-translate-y-2 -rotate-45" : ""
                }`}
              ></span>
            </button>
            <div className="hidden md:flex items-center gap-3">
              <ApiHealthBadge />
              <MerchantProfileCard />
            </div>
          </div>
        </div>

        {/* Mobile Menu Panel */}
        <div
          id="mobile-nav-menu"
          hidden={!isMenuOpen}
          className="border-t border-white/10 py-4 md:hidden"
        >
          <div className="mb-4 flex flex-col items-center justify-center gap-4">
            <MerchantProfileCard />
            <ApiHealthBadge />
          </div>
          <div className="flex flex-col gap-4">
            {appNavLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                className="text-sm text-slate-300 transition-colors hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
