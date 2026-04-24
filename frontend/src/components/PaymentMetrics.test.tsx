/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import PaymentMetrics from "./PaymentMetrics";
import { vi } from "vitest";

const t = (key: string) => key;

vi.mock("next-intl", () => ({
    useTranslations: () => t,
    useLocale: () => "en",
}));

vi.mock("@/lib/merchant-store", () => ({
    useMerchantApiKey: () => "mock-api-key",
    useMerchantHydrated: () => true,
    useMerchantId: () => "merchant-123",
    useHydrateMerchantStore: vi.fn(),
}));

globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
}));

vi.mock("recharts", () => ({
    ResponsiveContainer: ({ children }: any) => React.createElement("div", null, children),
    LineChart: ({ children }: any) => React.createElement("div", null, children),
    Line: () => React.createElement("div"),
    XAxis: () => React.createElement("div"),
    YAxis: () => React.createElement("div"),
    CartesianGrid: () => React.createElement("div"),
    Tooltip: () => React.createElement("div"),
    Legend: () => React.createElement("div"),
}));

describe("PaymentMetrics Component", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        globalThis.fetch = vi.fn();
    });

    it("renders loading skeleton initially", () => {
        // Fetch never resolves — component stays in loading state
        (globalThis.fetch as any).mockReturnValue(new Promise(() => {}));

        render(React.createElement(PaymentMetrics));

        // Check synchronously — loading=true on initial render shows skeleton
        expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
    });

    it("renders summary metrics after successful fetch", async () => {
        const mockSummary = {
            total_volume: 1500,
            confirmed_count: 42,
            success_rate: 98.5,
            data: [],
        };

        (globalThis.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => mockSummary })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ assets: [], data: [] }) });

        render(React.createElement(PaymentMetrics));

        await waitFor(() => {
            expect(screen.getByText("1,500")).toBeInTheDocument();
            expect(screen.getByText("42")).toBeInTheDocument();
            expect(screen.getByText("98.5%")).toBeInTheDocument();
        });
    });

    it("exposes an accessible chart region and hidden data table", async () => {
        (globalThis.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ total_volume: 1500, confirmed_count: 42, success_rate: 98.5, data: [] }) })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    assets: ["XLM", "USDC"],
                    data: [
                        { date: "2026-04-20", count: 2, XLM: 10, USDC: 5 },
                        { date: "2026-04-21", count: 1, XLM: 12, USDC: 0 },
                    ],
                }),
            });

        render(React.createElement(PaymentMetrics));

        await waitFor(() => {
            expect(screen.getByRole("region", { name: "chartTitle" })).toBeInTheDocument();
        });

        expect(screen.getByText(/Range 7D\. Showing 2 of 2 assets across 2 time periods\./)).toBeInTheDocument();
        expect(screen.getByRole("table", { name: "chartTitle data table" })).toBeInTheDocument();
        expect(screen.getByRole("columnheader", { name: "XLM" })).toBeInTheDocument();
        expect(screen.getByRole("cell", { name: "10" })).toBeInTheDocument();
    });

    it("renders error message on fetch failure", async () => {
        // Reject with non-Error so component uses t("fetchMetricsFailed") fallback
        (globalThis.fetch as any).mockRejectedValue("network failure");

        render(React.createElement(PaymentMetrics));

        await waitFor(() => {
            expect(screen.getByText("fetchMetricsFailed")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "retry" })).toBeInTheDocument();
        }, { timeout: 3000 });
    });

    it("displays 'No payments' message when assets list is empty", async () => {
        (globalThis.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => ({ total_volume: 0, confirmed_count: 0, success_rate: 0, data: [] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ assets: [], data: [] }) });

        render(React.createElement(PaymentMetrics));

        await waitFor(() => {
            expect(screen.getByText("noPayments")).toBeInTheDocument();
        });
    });
});
