"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useHydrateMerchantStore } from "@/lib/merchant-store";
import MerchantProfileCard from "@/components/MerchantProfileCard";
import ApiHealthBadge from "@/components/ApiHealthBadge";
import LocaleSwitcher from "@/components/LocaleSwitcher";

type AppNavLink = {
  href: string;
  label: string;
};

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Navbar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const appNavLinks: AppNavLink[] = [
    { href: "/", label: t("home") },
    { href: "/docs", label: t("docs") },
    { href: "/login", label: t("login") },
    { href: "/register", label: t("register") },
  ];

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
              aria-label={t("toggleMenu")}
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
            <LocaleSwitcher className="hidden sm:inline-flex md:hidden" />
            <div className="hidden md:flex items-center gap-3">
              <LocaleSwitcher />
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
            <LocaleSwitcher />
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
