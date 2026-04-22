"use client";

import { useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import Breadcrumbs from "@/components/Breadcrumbs";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import NotificationCenter from "@/components/NotificationCenter";
import PaymentToastListener from "@/components/PaymentToastListener";
import Sidebar from "@/components/Sidebar";
import SupportOverlay from "@/components/SupportOverlay";
import UserNav from "@/components/UserNav";
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
      <div className="dashboard-shell flex h-screen overflow-hidden bg-white text-[#0A0A0A]">
        <Sidebar
          mobileOpen={mobileSidebarOpen}
          onMobileOpenChange={setMobileSidebarOpen}
        />
        <PaymentToastListener />

        <main className="min-w-0 flex-1 flex flex-col overflow-hidden">
          <header className="shrink-0 flex h-20 items-center border-b border-[#F5F5F5] bg-white px-8 z-30">
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-6">
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(true)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E8E8E8] bg-white text-[#6B6B6B] transition-all hover:border-[#0A0A0A] hover:bg-[#F9F9F9] hover:text-[#0A0A0A] lg:hidden"
                  aria-label="Open navigation menu"
                  aria-controls="dashboard-sidebar-mobile"
                  aria-expanded={mobileSidebarOpen}
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7h16M4 12h16M4 17h16" />
                  </svg>
                </button>
                <Breadcrumbs />
              </div>
              
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 mr-2">
                  <NotificationCenter />
                  <LocaleSwitcher className="text-[#0A0A0A] border-none bg-transparent hover:bg-[#F5F5F5] rounded-lg transition-colors p-1" />
                </div>
                <div className="h-8 w-px bg-[#E8E8E8] mx-2" />
                <UserNav />
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1280px] p-8 lg:p-12">
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="min-w-0"
              >
                {children}
              </motion.section>
            </div>
          </div>
        </main>
        <SupportOverlay />
      </div>
    </AuthGuard>
  );
}
