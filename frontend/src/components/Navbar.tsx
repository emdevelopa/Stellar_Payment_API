"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { useHydrateMerchantStore } from "@/lib/merchant-store";
import MerchantProfileCard from "@/components/MerchantProfileCard";
import ApiHealthBadge from "@/components/ApiHealthBadge";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import ThemeToggle from "@/components/ThemeToggle";

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
    <div className="fixed top-2 left-0 right-0 z-50 flex justify-center px-6">
      <nav className="flex h-14 items-center justify-between gap-8 rounded-full border border-[#E8E8E8] bg-white/80 px-6 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all max-w-[1280px] w-full mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <span className="font-serif text-xl font-bold tracking-tight text-[#0A0A0A]">
            PLUTO
          </span>
        </Link>

        <div className="flex items-center gap-6">
          <div className="hidden items-center gap-1 md:flex">
            {appNavLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(pathname, link.href) ? "page" : undefined}
                className={`group relative rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all ${
                  isActive(pathname, link.href)
                    ? "text-[#0A0A0A]"
                    : "text-[#6B6B6B] hover:text-[#0A0A0A]"
                }`}
              >
                {link.label}
                {isActive(pathname, link.href) && (
                  <motion.div
                    layoutId="navbar-active"
                    className="absolute inset-0 z-[-1] rounded-full bg-[#F5F5F5]"
                  />
                )}
              </Link>
            ))}
          </div>

          <div className="h-4 w-px bg-[#E8E8E8] hidden md:block" />

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-3 md:flex">
                <LocaleSwitcher />
                <ApiHealthBadge />
            </div>
            <MerchantProfileCard />
            
            {/* Mobile Menu Button */}
            <button
              ref={triggerRef}
              onClick={toggleMenu}
              className="flex flex-col gap-1 md:hidden p-2 text-[#0A0A0A]"
              aria-label={t("toggleMenu")}
              aria-expanded={isMenuOpen}
              aria-controls="mobile-nav-menu"
            >
              <div className={`h-0.5 w-5 bg-[#0A0A0A] transition-all ${isMenuOpen ? "translate-y-1.5 rotate-45" : ""}`} />
              <div className={`h-0.5 w-5 bg-[#0A0A0A] transition-all ${isMenuOpen ? "opacity-0" : ""}`} />
              <div className={`h-0.5 w-5 bg-[#0A0A0A] transition-all ${isMenuOpen ? "-translate-y-1.5 -rotate-45" : ""}`} />
            </button>
          </div>
        </div>

        {/* Mobile Menu Panel */}
        <AnimatePresence>
          {isMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              className="absolute left-0 right-0 top-16 flex flex-col gap-4 rounded-3xl border border-[#E8E8E8] bg-white p-6 shadow-xl md:hidden"
            >
              <div className="flex flex-col gap-2">
                {appNavLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsMenuOpen(false)}
                    className="rounded-xl px-4 py-3 text-sm font-bold text-[#0A0A0A] hover:bg-[#F5F5F5]"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
              <div className="h-px bg-[#E8E8E8]" />
              <div className="flex items-center justify-between px-2">
                <LocaleSwitcher />
                <ApiHealthBadge />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </div>
  );
}
