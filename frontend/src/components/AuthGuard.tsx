"use client";

import React, { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  useMerchantHydrated,
  useMerchantSession,
  useHydrateMerchantStore,
} from "@/lib/merchant-store";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const hydrated = useMerchantHydrated();
  const session = useMerchantSession();
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  // Ensure the store is hydrated from localStorage
  useHydrateMerchantStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    console.log("[AuthGuard]", { mounted, hydrated, session });
    // Only redirect once both mounted and hydrated — avoids false redirects
    if (mounted && hydrated && !session) {
      router.push(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
    }
  }, [mounted, hydrated, session, router, pathname]);

  // Wait for client mount + store hydration before rendering or redirecting
  if (!mounted || !hydrated) return null;
  if (!session) return null;

  return <>{children}</>;
}
