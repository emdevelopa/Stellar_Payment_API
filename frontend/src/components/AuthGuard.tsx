"use client";

import React, { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useMerchantHydrated, useMerchantSession } from "@/lib/merchant-store";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const hydrated = useMerchantHydrated();
  const session = useMerchantSession();
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && hydrated && !session) {
      router.push(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
    }
  }, [mounted, hydrated, session, router, pathname]);

  if (!mounted || !hydrated || !session) {
    return null;
  }

  return <>{children}</>;
}
