export interface PaymentHistoryFilterState {
  search: string;
  status: string;
  asset: string;
  dateFrom: string;
  dateTo: string;
}

export type PaymentHistoryFilterKey = keyof PaymentHistoryFilterState;

export type PaymentHistoryFilterAction =
  | { type: "sync"; filters: PaymentHistoryFilterState }
  | {
      type: "set";
      key: PaymentHistoryFilterKey;
      value: PaymentHistoryFilterState[PaymentHistoryFilterKey];
    }
  | { type: "clear"; key: PaymentHistoryFilterKey }
  | { type: "reset" };

export const DEFAULT_PAYMENT_HISTORY_FILTERS: PaymentHistoryFilterState = {
  search: "",
  status: "all",
  asset: "all",
  dateFrom: "",
  dateTo: "",
};

export function paymentHistoryFiltersReducer(
  state: PaymentHistoryFilterState,
  action: PaymentHistoryFilterAction,
): PaymentHistoryFilterState {
  switch (action.type) {
    case "sync":
      return action.filters;
    case "set":
      return {
        ...state,
        [action.key]: action.value,
      };
    case "clear":
      return {
        ...state,
        [action.key]: action.key === "status" || action.key === "asset" ? "all" : "",
      };
    case "reset":
      return DEFAULT_PAYMENT_HISTORY_FILTERS;
    default:
      return state;
  }
}

export function filtersFromSearchParams(
  searchParams: Pick<URLSearchParams, "get">,
): PaymentHistoryFilterState {
  return {
    search: searchParams.get("search") ?? "",
    status: searchParams.get("status") ?? "all",
    asset: searchParams.get("asset") ?? "all",
    dateFrom: searchParams.get("date_from") ?? "",
    dateTo: searchParams.get("date_to") ?? "",
  };
}

export function buildPaymentHistorySearchParams(
  filters: PaymentHistoryFilterState,
): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.search) params.set("search", filters.search);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.asset !== "all") params.set("asset", filters.asset);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);

  return params;
}

export function hasActivePaymentHistoryFilters(
  filters: PaymentHistoryFilterState,
): boolean {
  return Boolean(
    filters.search ||
      filters.status !== "all" ||
      filters.asset !== "all" ||
      filters.dateFrom ||
      filters.dateTo,
  );
}
