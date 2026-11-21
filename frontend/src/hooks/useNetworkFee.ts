"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";

export const NETWORK_FEE_ERROR_TOAST_ID = "network-fee-error";

export interface NetworkFeeData {
  network: string;
  horizon_url: string;
  operation_count: number;
  stroops: number;
  xlm: string;
  last_ledger_base_fee: number;
}

interface NetworkFeeResponse {
  network_fee: NetworkFeeData;
}

interface UseNetworkFeeReturn {
  fee: NetworkFeeData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function useNetworkFee(enabled = true): UseNetworkFeeReturn {
  const [fee, setFee] = useState<NetworkFeeData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadFeeClient = useCallback(async () => import("@/lib/fee-client").catch(() => null), []);

  const fetchFee = useCallback(async () => {
    if (!enabled) return;
    await loadFeeClient();

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/network-fee`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Network fee unavailable");
      const data = (await res.json()) as NetworkFeeResponse;
      setFee(data.network_fee);
      toast.dismiss(NETWORK_FEE_ERROR_TOAST_ID);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      // Keep the last good estimate instead of blanking the UI, and surface
      // the failure in a single (deduplicated) toast.
      const message = "Network fee unavailable right now.";
      setError(message);
      toast.error(message, { id: NETWORK_FEE_ERROR_TOAST_ID });
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    fetchFee();
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchFee]);

  return { fee, isLoading, error, refetch: fetchFee };
}
