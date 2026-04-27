import { describe, expect, it } from "vitest";
import {
  buildPaymentHistorySearchParams,
  DEFAULT_PAYMENT_HISTORY_FILTERS,
  filtersFromSearchParams,
  hasActivePaymentHistoryFilters,
  paymentHistoryFiltersReducer,
} from "./payment-history-filters";

describe("paymentHistoryFiltersReducer", () => {
  it("updates a single filter field", () => {
    expect(
      paymentHistoryFiltersReducer(DEFAULT_PAYMENT_HISTORY_FILTERS, {
        type: "set",
        key: "status",
        value: "confirmed",
      }),
    ).toEqual({
      ...DEFAULT_PAYMENT_HISTORY_FILTERS,
      status: "confirmed",
    });
  });

  it("clears enum filters back to all", () => {
    expect(
      paymentHistoryFiltersReducer(
        { ...DEFAULT_PAYMENT_HISTORY_FILTERS, asset: "USDC" },
        {
          type: "clear",
          key: "asset",
        },
      ),
    ).toEqual(DEFAULT_PAYMENT_HISTORY_FILTERS);
  });

  it("resets all filters", () => {
    expect(
      paymentHistoryFiltersReducer(
        {
          search: "memo",
          status: "pending",
          asset: "XLM",
          dateFrom: "2026-04-01",
          dateTo: "2026-04-24",
        },
        { type: "reset" },
      ),
    ).toEqual(DEFAULT_PAYMENT_HISTORY_FILTERS);
  });
});

describe("filtersFromSearchParams", () => {
  it("parses search params into filter state", () => {
    const searchParams = new URLSearchParams(
      "search=invoice&status=confirmed&asset=USDC&date_from=2026-04-01&date_to=2026-04-24",
    );

    expect(filtersFromSearchParams(searchParams)).toEqual({
      search: "invoice",
      status: "confirmed",
      asset: "USDC",
      dateFrom: "2026-04-01",
      dateTo: "2026-04-24",
    });
  });
});

describe("buildPaymentHistorySearchParams", () => {
  it("omits default filters from the URL", () => {
    expect(
      buildPaymentHistorySearchParams(DEFAULT_PAYMENT_HISTORY_FILTERS).toString(),
    ).toBe("");
  });

  it("serializes active filters", () => {
    expect(
      buildPaymentHistorySearchParams({
        search: "invoice",
        status: "confirmed",
        asset: "USDC",
        dateFrom: "2026-04-01",
        dateTo: "2026-04-24",
      }).toString(),
    ).toBe(
      "search=invoice&status=confirmed&asset=USDC&date_from=2026-04-01&date_to=2026-04-24",
    );
  });
});

describe("hasActivePaymentHistoryFilters", () => {
  it("returns false for default filters", () => {
    expect(hasActivePaymentHistoryFilters(DEFAULT_PAYMENT_HISTORY_FILTERS)).toBe(false);
  });

  it("returns true when any filter is active", () => {
    expect(
      hasActivePaymentHistoryFilters({
        ...DEFAULT_PAYMENT_HISTORY_FILTERS,
        search: "invoice",
      }),
    ).toBe(true);
  });
});