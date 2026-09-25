import { useEffect, useReducer, useCallback, useRef } from "react";

export interface Balance {
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

export interface BalanceSyncState {
  balances: Balance[];
  isLoading: boolean;
  lastUpdated: Date | null;
  error: string | null;
  optimisticBalances: Record<string, string>;
}

export type BalanceSyncAction =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; balances: Balance[]; at: Date }
  | { type: "FETCH_ERROR"; error: string }
  | { type: "OPTIMISTIC_UPDATE"; code: string; balance: string }
  | { type: "RESET" };

export const initialBalanceSyncState: BalanceSyncState = {
  balances: [],
  isLoading: false,
  lastUpdated: null,
  error: null,
  optimisticBalances: {},
};

function balanceSyncReducer(
  state: BalanceSyncState,
  action: BalanceSyncAction,
): BalanceSyncState {
  switch (action.type) {
    case "FETCH_START":
      return { ...state, isLoading: true, error: null };
    case "FETCH_SUCCESS":
      return {
        ...state,
        balances: action.balances,
        isLoading: false,
        lastUpdated: action.at,
        error: null,
        optimisticBalances: {},
      };
    case "FETCH_ERROR":
      return { ...state, isLoading: false, error: action.error };
    case "OPTIMISTIC_UPDATE":
      return {
        ...state,
        optimisticBalances: {
          ...state.optimisticBalances,
          [action.code]: action.balance,
        },
      };
    case "RESET":
      return { ...initialBalanceSyncState };
    default:
      return state;
  }
}

function applyOptimisticOverrides(
  balances: Balance[],
  optimistic: Record<string, string>,
): Balance[] {
  if (Object.keys(optimistic).length === 0) return balances;
  const merged = balances.map((b) =>
    b.code in optimistic ? { ...b, balance: optimistic[b.code] } : b,
  );
  for (const [code, balance] of Object.entries(optimistic)) {
    if (!merged.find((b) => b.code === code)) {
      merged.push({ code, balance });
    }
  }
  return merged;
}

export function useBalanceSync(
  merchantId: string | null | undefined,
  apiKey: string | null | undefined,
  options: UseBalanceSyncOptions = {},
) {
  const {
    pollingInterval = 30000,
    onUpdate,
    enabled = true,
    address = null,
    horizonUrl = "https://horizon-testnet.stellar.org",
  } = options;

  const [state, dispatch] = useReducer(balanceSyncReducer, initialBalanceSyncState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const fetchBalances = useCallback(async () => {
    if (!enabled) return;
    if (!address && (!merchantId || !apiKey)) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    dispatch({ type: "FETCH_START" });
    try {
      let newBalances: Balance[] = [];

      if (address) {
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
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
        const response = await fetch(`${apiUrl}/api/merchant/balances`, {
          headers: { "x-api-key": apiKey! },
          signal: abortControllerRef.current.signal,
        });
        if (!response.ok) throw new Error("Failed to fetch balances from API");
        const data = await response.json();
        newBalances = (data.balances || []).map((b: any) => ({
          code: b.asset || b.code,
          balance: b.amount || b.balance,
        }));
      }

      dispatch({ type: "FETCH_SUCCESS", balances: newBalances, at: new Date() });
      onUpdateRef.current?.(newBalances);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "Balance sync failed";
      console.error("Balance sync error:", error);
      dispatch({ type: "FETCH_ERROR", error: message });
    }
  }, [merchantId, apiKey, enabled, address, horizonUrl]);

  const applyOptimistic = useCallback((code: string, balance: string) => {
    dispatch({ type: "OPTIMISTIC_UPDATE", code, balance });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  useEffect(() => {
    fetchBalances();

    if (enabled && pollingInterval > 0) {
      const interval = setInterval(fetchBalances, pollingInterval);
      return () => {
        clearInterval(interval);
        abortControllerRef.current?.abort();
      };
    }
  }, [fetchBalances, enabled, pollingInterval]);

  const visibleBalances = applyOptimisticOverrides(
    state.balances,
    state.optimisticBalances,
  );

  const liveRegionText = state.isLoading
    ? "Syncing balances\u2026"
    : state.error
      ? `Balance sync error: ${state.error}`
      : state.lastUpdated
        ? `Balances updated at ${state.lastUpdated.toLocaleTimeString()}.`
        : "";

  return {
    balances: visibleBalances,
    isLoading: state.isLoading,
    lastUpdated: state.lastUpdated,
    error: state.error,
    refresh: fetchBalances,
    applyOptimistic,
    reset,
    isStale: state.lastUpdated
      ? Date.now() - state.lastUpdated.getTime() > pollingInterval * 2
      : true,
    ariaLabel: "Real-time balance information",
    liveRegionText,
  };
}
