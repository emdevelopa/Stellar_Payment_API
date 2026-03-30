"use client";

import { useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import Breadcrumbs from "@/components/Breadcrumbs";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import NotificationCenter from "@/components/NotificationCenter";
import PaymentToastListener from "@/components/PaymentToastListener";
import Sidebar from "@/components/Sidebar";
import SupportOverlay from "@/components/SupportOverlay";
import { useHydrateMerchantStore } from "@/lib/merchant-store";
import { motion } from "framer-motion";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useHydrateMerchantStore();

  return (
    <AuthGuard>
      <div className="dashboard-shell flex min-h-screen overflow-x-hidden bg-black">
        <Sidebar
          mobileOpen={mobileSidebarOpen}
          onMobileOpenChange={setMobileSidebarOpen}
        />
        <PaymentToastListener />

        <main className="min-w-0 flex-1 overflow-x-hidden">
          <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col p-6 lg:p-10">
            <header className="mb-10 flex flex-col gap-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setMobileSidebarOpen(true)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
                    aria-label="Open navigation menu"
                    aria-controls="dashboard-sidebar-mobile"
                    aria-expanded={mobileSidebarOpen}
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
                        d="M4 7h16M4 12h16M4 17h16"
                      />
                    </svg>
                  </button>
                  <Breadcrumbs />
                </div>
                <div className="flex items-center gap-4">
                  <NotificationCenter />
                  <LocaleSwitcher className="w-fit self-start sm:self-auto" />
                </div>
              </div>
              <div className="h-px w-full bg-gradient-to-r from-white/10 to-transparent" />
            </header>

            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="min-w-0 pb-10"
            >
              {children}
            </motion.section>
          </div>
        </main>
        <SupportOverlay />
      </div>
    </AuthGuard>
  );
}
