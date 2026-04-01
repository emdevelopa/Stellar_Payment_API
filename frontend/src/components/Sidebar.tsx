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
      className="flex flex-1 flex-col gap-1 px-4 py-8"
    >
      {navItems.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-[6px] px-3 py-2.5 transition-all 150ms ease ${
              isActive
                ? "bg-[#0A0A0A] text-white shadow-none"
                : "text-[#6B6B6B] hover:bg-[#F5F5F5] hover:text-[#0A0A0A]"
            }`}
          >
            <span className="shrink-0">
              {item.icon}
            </span>
            <span className="text-xs font-semibold tracking-wide">{item.label}</span>
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
      <div className="flex h-16 items-center border-b border-[#E8E8E8] px-6">
        <Link href="/" className="font-display text-2xl tracking-tight text-[#0A0A0A]">
          Pluto
        </Link>
      </div>

      <NavLinks
        isCollapsed={false}
        pathname={pathname}
        t={t}
        onNavigate={() => onMobileOpenChange(false)}
      />

      <div className="p-4">
        <div className="rounded-lg bg-[#F5F5F5] p-5">
           <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
            {t("network")}
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs font-medium text-[#0A0A0A]">
            <span className="h-2 w-2 rounded-full bg-[#111111]" />
            Stellar Mainnet
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <aside
        id="dashboard-sidebar-navigation"
        className="sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col border-r border-[#E8E8E8] bg-white lg:flex"
      >
        {chrome}
      </aside>

      <motion.div
        initial={false}
        id="dashboard-sidebar-mobile"
        animate={{
          opacity: mobileOpen ? 1 : 0,
          pointerEvents: mobileOpen ? "auto" : "none",
        }}
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm lg:hidden"
        onClick={() => onMobileOpenChange(false)}
      />
      <motion.aside
        initial={false}
        animate={{ x: mobileOpen ? 0 : "-100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="fixed inset-y-0 left-0 z-[60] flex w-[280px] flex-col border-r border-[#E8E8E8] bg-white lg:hidden"
      >
        {chrome}
      </motion.aside>
    </>
  );
}
