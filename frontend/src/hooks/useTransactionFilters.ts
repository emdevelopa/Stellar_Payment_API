"use client";

import { useReducer, useState, useCallback, useRef, useEffect, useTransition } from "react";
import {
  paymentHistoryFiltersReducer,
  DEFAULT_PAYMENT_HISTORY_FILTERS,
  filtersFromSearchParams,
  buildPaymentHistorySearchParams,
  hasActivePaymentHistoryFilters,
  type PaymentHistoryFilterKey,
  type PaymentHistoryFilterState,
} from "@/lib/payment-history-filters";

const SEARCH_DEBOUNCE_MS = 350;

/**
 * Manages TransactionFilterSidebar state with optimistic UI updates.
 *
 * Draft state (the `filters` return value) updates synchronously on every
 * interaction so the sidebar feels instant. URL sync is deferred:
 *   - Search: debounced 350 ms after the last keystroke.
 *   - All other filters: pushed inside a React transition (non-blocking).
 *
 * `searchSyncPending` stays true while a debounced search is in flight so
 * callers can show a subtle syncing indicator without blocking input.
 * `isFilterPending` reflects the React transition for non-search filters.
 */
export function useTransactionFilters(
  pushSearchParams: (params: URLSearchParams) => void,
  initialSearchParams?: URLSearchParams,
) {
  const [filters, dispatch] = useReducer(
    paymentHistoryFiltersReducer,
    undefined,
    () =>
      initialSearchParams
        ? filtersFromSearchParams(initialSearchParams)
        : DEFAULT_PAYMENT_HISTORY_FILTERS,
  );

  const [searchSyncPending, setSearchSyncPending] = useState(false);
  const [isFilterPending, startTransition] = useTransition();

  // Always-current snapshot of filter state for use inside async callbacks.
  const filtersRef = useRef<PaymentHistoryFilterState>(filters);
  filtersRef.current = filters;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelDebounce = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  // Cancel any in-flight debounce when the hook unmounts.
  useEffect(() => () => cancelDebounce(), [cancelDebounce]);

  const onFilterChange = useCallback(
    (key: PaymentHistoryFilterKey, value: string) => {
      // Optimistic update: draft state reflects the change immediately.
      dispatch({ type: "set", key, value });

      if (key === "search") {
        // Debounce URL sync so rapid keystrokes don't flood navigation.
        setSearchSyncPending(true);
        cancelDebounce();
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          // filtersRef.current holds the latest reducer state at fire time.
          pushSearchParams(buildPaymentHistorySearchParams(filtersRef.current));
          setSearchSyncPending(false);
        }, SEARCH_DEBOUNCE_MS);
      } else {
        // Non-search filters: push to URL inside a transition (keeps UI responsive).
        startTransition(() => {
          pushSearchParams(
            buildPaymentHistorySearchParams({ ...filtersRef.current, [key]: value }),
          );
        });
      }
    },
    [pushSearchParams, cancelDebounce, startTransition],
  );

  const onClearFilter = useCallback(
    (key: PaymentHistoryFilterKey) => {
      if (key === "search") {
        cancelDebounce();
        setSearchSyncPending(false);
      }
      dispatch({ type: "clear", key });
      const defaultValue = key === "status" || key === "asset" ? "all" : "";
      pushSearchParams(
        buildPaymentHistorySearchParams({ ...filtersRef.current, [key]: defaultValue }),
      );
    },
    [pushSearchParams, cancelDebounce],
  );

  const onClearAll = useCallback(() => {
    cancelDebounce();
    setSearchSyncPending(false);
    dispatch({ type: "reset" });
    pushSearchParams(new URLSearchParams());
  }, [pushSearchParams, cancelDebounce]);

  return {
    filters,
    onFilterChange,
    onClearFilter,
    onClearAll,
    hasActiveFilters: hasActivePaymentHistoryFilters(filters),
    searchSyncPending,
    isFilterPending,
  };
}
