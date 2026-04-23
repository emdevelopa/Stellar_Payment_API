"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { memo, useCallback, useMemo, useEffect, useRef } from "react";

function getNavItems(t: ReturnType<typeof useTranslations>) {
  return [
    {
      label: t("overview"),
      href: "/dashboard",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      ),
    },
    {
      label: t("createPayment"),
      href: "/create",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      ),
      highlight: true,
    },
    {
      label: t("payments"),
      href: "/payments",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: "History",
      href: "/payment-history",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
    },
    {
      label: t("webhookLogs"),
      href: "/webhook-logs",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9h8M8 13h5m-7 8h12a2 2 0 002-2V7l-4-4H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      label: t("settings"),
      href: "/settings",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
  ];
}

interface SidebarProps {
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

const NavLinks = memo(function NavLinks({
  pathname,
  t,
  onNavigate,
}: {
  pathname: string;
  t: ReturnType<typeof useTranslations>;
  onNavigate?: () => void;
}) {
  const navItems = useMemo(() => getNavItems(t), [t]);

  return (
    <nav aria-label="Dashboard navigation" className="flex flex-1 flex-col gap-1 px-4 py-6">
      {navItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const isHighlight = "highlight" in item && item.highlight;
        const isExternal = "external" in item && item.external;

        if (isExternal) {
          return (
            <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" onClick={onNavigate}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-pluto-600 transition-colors duration-150 hover:bg-[var(--pluto-50)] hover:text-[var(--pluto-800)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-300)]">
              <span className="shrink-0">{item.icon}</span>
              <span className="text-xs font-semibold tracking-wide">{item.label}</span>
              <svg className="h-3 w-3 ml-auto opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            </a>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={true}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-300)] ${
              isActive
                ? "bg-[var(--pluto-500)] text-white"
                : isHighlight
                ? "border border-[var(--pluto-200)] bg-[var(--pluto-50)] text-[var(--pluto-700)] hover:border-[var(--pluto-500)] hover:bg-[var(--pluto-500)] hover:text-white"
                : "text-pluto-600 hover:bg-[var(--pluto-100)] hover:text-[var(--pluto-800)]"
            }`}
          >
            <span className="shrink-0">{item.icon}</span>
            <span className="text-xs font-semibold tracking-wide">{item.label}</span>
          </Link>
        );
      })}

      <div className="mt-auto pt-4 border-t border-pluto-200">
        <Link href="/" onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-pluto-600 transition-colors duration-150 hover:bg-[var(--pluto-50)] hover:text-[var(--pluto-800)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-300)]"
        >
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          <span className="text-xs font-semibold tracking-wide">Home</span>
        </Link>
      </div>
    </nav>
  );
});

NavLinks.displayName = "NavLinks";

export default function Sidebar({
  mobileOpen,
  onMobileOpenChange,
}: SidebarProps) {
  const t = useTranslations("sidebar");
  const pathname = usePathname();
  const handleNavigate = useCallback(() => onMobileOpenChange(false), [onMobileOpenChange]);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Lock body scroll and handle ESC key when mobile sidebar is open
  useEffect(() => {
    if (!mobileOpen) return;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(() => closeBtnRef.current?.focus(), 50);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onMobileOpenChange(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileOpen, onMobileOpenChange]);

  const navLinks = (
    <NavLinks
      pathname={pathname}
      t={t}
      onNavigate={handleNavigate}
    />
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        id="dashboard-sidebar-navigation"
        className="sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col border-r border-pluto-200 bg-white lg:flex"
      >
        <div className="flex h-16 items-center border-b border-pluto-200 px-6">
          <Link href="/" className="font-display text-2xl tracking-tight" style={{ color: "var(--pluto-500)" }}>
            Pluto
          </Link>
        </div>
        {navLinks}
      </aside>

      {/* Mobile overlay */}
      <motion.div
        initial={false}
        animate={{
          opacity: mobileOpen ? 1 : 0,
          pointerEvents: mobileOpen ? "auto" : "none",
        }}
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm lg:hidden"
        onClick={() => onMobileOpenChange(false)}
        aria-hidden="true"
      />

      {/* Mobile sidebar drawer */}
      <motion.aside
        initial={false}
        animate={{ x: mobileOpen ? 0 : "-100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        id="dashboard-sidebar-mobile"
        role="dialog"
        aria-modal="true"
        aria-label={t("close")}
        className="fixed inset-y-0 left-0 z-[60] flex w-[min(280px,85vw)] flex-col border-r border-pluto-200 bg-white lg:hidden"
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-pluto-200 px-4 sm:px-6">
          <Link href="/" className="font-display text-2xl tracking-tight" style={{ color: "var(--pluto-500)" }}>
            Pluto
          </Link>
          <button
            ref={closeBtnRef}
            onClick={() => onMobileOpenChange(false)}
            aria-label={t("close")}
            className="flex items-center justify-center rounded-lg p-2 text-pluto-600 transition-colors hover:bg-pluto-50 hover:text-pluto-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pluto-300"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {navLinks}
      </motion.aside>
    </>
  );
}
