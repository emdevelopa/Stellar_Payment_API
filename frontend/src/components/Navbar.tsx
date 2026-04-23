"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { useHydrateMerchantStore } from "@/lib/merchant-store";
import MerchantProfileCard from "@/components/MerchantProfileCard";
import ApiHealthBadge from "@/components/ApiHealthBadge";

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
    <motion.div 
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 100, damping: 20, delay: 0.1 }}
      className="fixed top-3 left-0 right-0 z-50 flex justify-center px-4 sm:px-6"
    >
      <nav aria-label="Main navigation" className="flex h-14 items-center justify-between gap-5 rounded-full border border-pluto-200 bg-white/90 px-4 sm:px-6 backdrop-blur-xl shadow-[0_10px_30px_rgb(0,0,0,0.06)] transition-all max-w-[1280px] w-full mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <span className="font-display text-lg sm:text-xl font-bold tracking-tighter text-[#0A0A0A] uppercase">
            PLUTO
          </span>
        </Link>

        <div className="flex items-center gap-4 sm:gap-6">
          <div className="hidden items-center gap-1 md:flex">
            {appNavLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(pathname, link.href) ? "page" : undefined}
                className={`group relative rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all ${
                  isActive(pathname, link.href)
                    ? "text-pluto-900"
                    : "text-pluto-600 hover:text-pluto-900"
                }`}
              >
                {link.label}
                {isActive(pathname, link.href) && (
                  <motion.div
                    layoutId="navbar-active"
                    className="absolute inset-0 z-[-1] rounded-full bg-pluto-50"
                    transition={{ type: "spring", bounce: 0.25, duration: 0.5 }}
                  />
                )}
              </Link>
            ))}
          </div>

          <div className="h-4 w-px bg-pluto-200 hidden md:block" aria-hidden="true" />

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-3 md:flex">
                <ApiHealthBadge />
            </div>
            <MerchantProfileCard />
            
            <button
              ref={triggerRef}
              onClick={toggleMenu}
              className="flex flex-col gap-1 md:hidden p-2 text-pluto-900 rounded-lg hover:bg-pluto-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pluto-300"
              aria-label={t("toggleMenu")}
              aria-expanded={isMenuOpen}
              aria-controls="mobile-nav-menu"
              aria-haspopup="true"
            >
              <motion.div 
                animate={isMenuOpen ? { rotate: 45, y: 6 } : { rotate: 0, y: 0 }}
                className="h-0.5 w-5 bg-pluto-900" 
                aria-hidden="true"
              />
              <motion.div 
                animate={isMenuOpen ? { opacity: 0 } : { opacity: 1 }}
                className="h-0.5 w-5 bg-pluto-900" 
                aria-hidden="true"
              />
              <motion.div 
                animate={isMenuOpen ? { rotate: -45, y: -6 } : { rotate: 0, y: 0 }}
                className="h-0.5 w-5 bg-pluto-900" 
                aria-hidden="true"
              />
            </button>
          </div>
        </div>

        <AnimatePresence>
          {isMenuOpen && (
            <motion.div
              id="mobile-nav-menu"
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              aria-label="Mobile navigation menu"
              className="absolute left-0 right-0 top-16 flex flex-col gap-4 rounded-3xl border border-pluto-200 bg-white p-5 shadow-xl md:hidden"
            >
              <div className="flex flex-col gap-2">
                {appNavLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsMenuOpen(false)}
                    aria-current={isActive(pathname, link.href) ? "page" : undefined}
                    className={`rounded-xl px-4 py-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pluto-300 ${
                      isActive(pathname, link.href)
                        ? "bg-pluto-50 text-pluto-900"
                        : "text-pluto-900 hover:bg-pluto-50"
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
              <div className="h-px bg-pluto-200" aria-hidden="true" />
              <div className="flex items-center justify-end px-2">
                <ApiHealthBadge />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </motion.div>
  );
}
