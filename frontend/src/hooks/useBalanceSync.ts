import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { useSwipeToDismiss } from "./useSwipeToDismiss";

export interface Balance {
  code: string;
  balance: string;
}

export const BALANCE_SYNC_ERROR_TOAST_ID = "balance-sync-error";

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
  rollbackMessage: string | null;
  isDrawerOpen: boolean;
}

export type BalanceSyncAction =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; balances: Balance[]; at: Date }
  | { type: "FETCH_ERROR"; error: string; rolledBack?: boolean }
  | { type: "OPTIMISTIC_UPDATE"; code: string; balance: string }
  | { type: "ROLLBACK_OPTIMISTIC"; reason?: string }
  | { type: "OPEN_DRAWER" }
  | { type: "CLOSE_DRAWER" }
  | { type: "TOGGLE_DRAWER" }
  | { type: "RESET" };

export const initialBalanceSyncState: BalanceSyncState = {
  balances: [],
  isLoading: false,
  lastUpdated: null,
  error: null,
  optimisticBalances: {},
  rollbackMessage: null,
  isDrawerOpen: false,
};

export function balanceSyncReducer(
  state: BalanceSyncState,
  action: BalanceSyncAction,
): BalanceSyncState {
  switch (action.type) {
    case "FETCH_START":
      return { ...state, isLoading: true, error: null, rollbackMessage: null };
    case "FETCH_SUCCESS":
      return {
        ...state,
        balances: action.balances,
        isLoading: false,
        lastUpdated: action.at,
        error: null,
        optimisticBalances: {},
        rollbackMessage: null,
      };
    case "FETCH_ERROR": {
      const hadOptimistic = Object.keys(state.optimisticBalances).length > 0;
      return {
        ...state,
        isLoading: false,
        error: action.error,
        optimisticBalances: {},
        rollbackMessage:
          hadOptimistic || action.rolledBack
            ? `${action.error}. Optimistic balances were rolled back.`
            : null,
      };
    }
    case "OPTIMISTIC_UPDATE":
      return {
        ...state,
        optimisticBalances: {
          ...state.optimisticBalances,
          [action.code]: action.balance,
        },
        rollbackMessage: null,
      };
    case "ROLLBACK_OPTIMISTIC":
      return {
        ...state,
        optimisticBalances: {},
        rollbackMessage: action.reason ?? "Optimistic balances were rolled back.",
      };
    case "OPEN_DRAWER":
      return { ...state, isDrawerOpen: true };
    case "CLOSE_DRAWER":
      return { ...state, isDrawerOpen: false };
    case "TOGGLE_DRAWER":
      return { ...state, isDrawerOpen: !state.isDrawerOpen };
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
  const [isMobile, setIsMobile] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const onUpdateRef = useRef(onUpdate);
  const stateRef = useRef(state);
  onUpdateRef.current = onUpdate;
  stateRef.current = state;

  const closeDrawer = useCallback(() => {
    dispatch({ type: "CLOSE_DRAWER" });
  }, []);

  const openDrawer = useCallback(() => {
    dispatch({ type: "OPEN_DRAWER" });
  }, []);

  const toggleDrawer = useCallback(() => {
    dispatch({ type: "TOGGLE_DRAWER" });
  }, []);

  const {
    offset: drawerOffset,
    dragging: drawerDragging,
    handlers: drawerHandlers,
  } = useSwipeToDismiss({
    onDismiss: closeDrawer,
    enabled: state.isDrawerOpen,
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(query.matches);
    update();

    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }

    if (typeof query.addListener === "function") {
      query.addListener(update);
      return () => query.removeListener(update);
    }
  }, []);

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
      const rawMessage = error instanceof Error ? error.message : "Balance sync failed";
      const message = error instanceof TypeError ? `Network error: ${rawMessage}` : rawMessage;
      const hadOptimistic = Object.keys(stateRef.current.optimisticBalances).length > 0;
      console.error("Balance sync error:", error);
      dispatch({ type: "FETCH_ERROR", error: message, rolledBack: hadOptimistic });
      toast.error(
        hadOptimistic
          ? `Balance sync failed: ${message}. Optimistic balances were rolled back.`
          : `Balance sync failed: ${message}`,
      );
    }
  }, [merchantId, apiKey, enabled, address, horizonUrl]);

  const applyOptimistic = useCallback((code: string, balance: string) => {
    dispatch({ type: "OPTIMISTIC_UPDATE", code, balance });
  }, []);

  const rollbackOptimistic = useCallback(() => {
    if (Object.keys(stateRef.current.optimisticBalances).length === 0) return;
    dispatch({ type: "ROLLBACK_OPTIMISTIC" });
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
      ? `Balance sync error: ${state.error}${state.rollbackMessage ? ` ${state.rollbackMessage}` : ""}`
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
    rollbackOptimistic,
    reset,
    rollbackMessage: state.rollbackMessage,
    isStale: state.lastUpdated
      ? Date.now() - state.lastUpdated.getTime() > pollingInterval * 2
      : true,
    ariaLabel: "Real-time balance information",
    ariaLive: "polite" as const,
    ariaAtomic: true,
    liveRegionText,
    isDrawerOpen: state.isDrawerOpen,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    isMobile,
    drawerOffset,
    drawerDragging,
    drawerHandlers,
    drawer: {
      isOpen: state.isDrawerOpen,
      offset: drawerOffset,
      dragging: drawerDragging,
      handlers: drawerHandlers,
      isMobile,
      open: openDrawer,
      close: closeDrawer,
      toggle: toggleDrawer,
    },
  };
}
