"use client";

import Sidebar from "@/components/Sidebar";
import Breadcrumbs from "@/components/Breadcrumbs";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import PaymentToastListener from "@/components/PaymentToastListener";
import { motion } from "framer-motion";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-black">
      {/* Sidebar - fixed width for desktop layout offset */}
      <Sidebar />
      <PaymentToastListener />

      {/* Main Content Area */}
      <main className="flex-1 transition-all lg:pl-[260px]">
        <div className="mx-auto flex max-w-7xl flex-col p-6 lg:p-10">
          {/* Header with Breadcrumbs */}
          <header className="mb-10 flex flex-col gap-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <Breadcrumbs />
              <LocaleSwitcher className="w-fit self-start sm:self-auto" />
            </div>
            <div className="h-px w-full bg-gradient-to-r from-white/10 to-transparent" />
          </header>

          {/* Page Content */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="pb-20 lg:pb-0"
          >
            {children}
          </motion.section>
        </div>
      </main>
    </div>
  );
}
