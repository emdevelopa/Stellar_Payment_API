"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { useLocalStorage } from "@/hooks/useLocalStorage";

function getNavItems(t: ReturnType<typeof useTranslations>) {
  return [
    {
      label: t("overview"),
      href: "/dashboard",
      icon: (
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
          />
        </svg>
      ),
    },
    {
      label: t("payments"),
      href: "/payments",
      icon: (
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    {
      label: t("webhookLogs"),
      href: "/webhook-logs",
      icon: (
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 9h8M8 13h5m-7 8h12a2 2 0 002-2V7l-4-4H6a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
      ),
    },
    {
      label: t("settings"),
      href: "/settings",
      icon: (
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 6V4M12 20v-2M4 12H2m20 0h-2M4.929 4.929l1.414 1.414m11.314 11.314l1.414 1.414M4.929 19.071l1.414-1.414m11.314-11.314l1.414-1.414"
          />
        </svg>
      ),
    },
  ];
}

interface SidebarProps {
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

function NavLinks({
  isCollapsed,
  pathname,
  t,
  onNavigate,
}: {
  isCollapsed: boolean;
  pathname: string;
  t: ReturnType<typeof useTranslations>;
  onNavigate?: () => void;
}) {
  const navItems = getNavItems(t);

  return (
    <nav
      aria-label="Dashboard navigation"
      className="flex flex-1 flex-col gap-2 px-3 py-6"
    >
      {navItems.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-4 rounded-2xl px-4 py-3 transition-all ${
              isActive
                ? "bg-mint text-black font-semibold shadow-[0_0_20px_rgba(45,212,191,0.2)]"
                : "text-slate-200 hover:bg-white/5 hover:text-white focus-visible:bg-white/10 focus-visible:text-white"
            }`}
          >
            <span className={isActive ? "text-black" : "text-slate-300"}>
              {item.icon}
            </span>
            {!isCollapsed && <span className="text-sm">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export default function Sidebar({
  mobileOpen,
  onMobileOpenChange,
}: SidebarProps) {
  const t = useTranslations("sidebar");
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useLocalStorage(
    "dashboard-sidebar-collapsed",
    false,
  );

  const secondaryLinks = [
    { label: t("createPayment"), href: "/dashboard/create" },
    { label: t("apiKeys"), href: "/api-keys" },
  ];

  const chrome = (
    <>
      <div className="flex h-20 items-center justify-between border-b border-white/10 px-5">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-mint">
            {isCollapsed ? "SP" : "Stellar Pay"}
          </p>
          {!isCollapsed && (
            <p className="mt-1 text-xs text-slate-500">{t("workspace")}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsCollapsed((value) => !value)}
          className="hidden rounded-xl p-2 text-slate-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:bg-white/10 focus-visible:text-white lg:inline-flex"
          aria-label={isCollapsed ? t("expand") : t("collapse")}
          aria-controls="dashboard-sidebar-navigation"
          aria-expanded={!isCollapsed}
        >
          <svg
            className={`h-5 w-5 transition-transform ${isCollapsed ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onMobileOpenChange(false)}
          className="rounded-xl p-2 text-slate-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:bg-white/10 focus-visible:text-white lg:hidden"
          aria-label={t("close")}
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <NavLinks
        isCollapsed={isCollapsed}
        pathname={pathname}
        t={t}
        onNavigate={() => onMobileOpenChange(false)}
      />

      <div className="border-t border-white/10 p-4">
        <div
          className={`rounded-2xl border border-white/10 bg-black/40 p-4 transition-all ${isCollapsed ? "px-3" : ""}`}
        >
          {!isCollapsed && (
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-300">
                {t("shortcuts")}
              </p>
          )}
          <div
            className={`mt-3 flex ${isCollapsed ? "flex-col gap-2" : "flex-col gap-3"}`}
          >
            {secondaryLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => onMobileOpenChange(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white"
              >
                {isCollapsed ? link.label.slice(0, 1) : link.label}
              </Link>
            ))}
          </div>
          {!isCollapsed && (
            <div className="mt-4 flex items-center gap-2 text-xs font-mono text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-mint" />
              {t("network")}
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <>
      <motion.aside
        initial={false}
        animate={{ width: isCollapsed ? 96 : 280 }}
        id="dashboard-sidebar-navigation"
        className="sticky top-0 hidden h-screen shrink-0 border-r border-white/10 bg-black/40 backdrop-blur-xl lg:flex"
      >
        {chrome}
      </motion.aside>

      <motion.div
        initial={false}
        id="dashboard-sidebar-mobile"
        animate={{
          opacity: mobileOpen ? 1 : 0,
          pointerEvents: mobileOpen ? "auto" : "none",
        }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden"
        onClick={() => onMobileOpenChange(false)}
      />
      <motion.aside
        initial={false}
        animate={{ x: mobileOpen ? 0 : "-100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="fixed inset-y-0 left-0 z-[60] flex w-[86vw] max-w-[320px] flex-col border-r border-white/10 bg-black/90 backdrop-blur-xl lg:hidden"
      >
        {chrome}
      </motion.aside>
    </>
  );
}
