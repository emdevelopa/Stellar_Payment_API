import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";

interface Balance {
  code: string;
  balance: string;
}

interface UseBalanceSyncOptions {
  pollingInterval?: number;
  onUpdate?: (balances: Balance[]) => void;
  enabled?: boolean;
  address?: string | null;
  horizonUrl?: string;
}

/**
 * Hook for real-time balance synchronization with polling and race condition prevention.
 */
export function useBalanceSync(
  merchantId: string | null | undefined,
  apiKey: string | null | undefined,
  options: UseBalanceSyncOptions = {}
) {
  const { 
    pollingInterval = 30000, 
    onUpdate, 
    enabled = true,
    address = null,
    horizonUrl = "https://horizon-testnet.stellar.org"
  } = options;
  const [balances, setBalances] = useState<Balance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchBalances = useCallback(async () => {
    if (!enabled) return;
    if (!address && (!merchantId || !apiKey)) return;

    // Cancel previous request to prevent race conditions
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    try {
      let newBalances: Balance[] = [];

      if (address) {
        // Fetch from Horizon directly if address is provided
        const response = await fetch(`${horizonUrl}/accounts/${address}`, {
          signal: abortControllerRef.current.signal,
        });
        if (!response.ok) throw new Error("Failed to fetch account from Horizon");
        const data = await response.json();
        newBalances = data.balances.map((b: any) => ({
          code: b.asset_type === "native" ? "XLM" : b.asset_code,
          balance: b.balance,
        }));
      } else {
        // Fetch from merchant API
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const response = await fetch(`${apiUrl}/api/merchant/balances`, {
          headers: {
            "x-api-key": apiKey!,
          },
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) throw new Error("Failed to fetch balances from API");

        const data = await response.json();
        newBalances = (data.balances || []).map((b: any) => ({
          code: b.asset || b.code,
          balance: b.amount || b.balance,
        }));
      }

      setBalances(newBalances);
      setLastUpdated(new Date());
      onUpdate?.(newBalances);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      console.error("Balance sync error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [merchantId, apiKey, enabled, onUpdate, address, horizonUrl]);

  useEffect(() => {
    fetchBalances();

    if (enabled && pollingInterval > 0) {
      const interval = setInterval(fetchBalances, pollingInterval);
      return () => {
        clearInterval(interval);
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
      };
    }
  }, [fetchBalances, enabled, pollingInterval]);

  return {
    balances,
    isLoading,
    lastUpdated,
    refresh: fetchBalances,
    isStale: lastUpdated ? Date.now() - lastUpdated.getTime() > pollingInterval * 2 : true,
  };
}
