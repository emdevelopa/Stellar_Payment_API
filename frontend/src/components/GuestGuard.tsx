"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMerchantHydrated, useMerchantSession } from "@/lib/merchant-store";

export default function GuestGuard({ children }: { children: React.ReactNode }) {
  const hydrated = useMerchantHydrated();
  const session = useMerchantSession();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && hydrated && session) {
      router.push("/dashboard");
    }
  }, [mounted, hydrated, session, router]);

  // If we are definitely authenticated, hide the public UI so it doesn't flash
  // before the redirect kicks in.
  if (mounted && hydrated && session) {
    return null; 
  }

  return <>{children}</>;
}
