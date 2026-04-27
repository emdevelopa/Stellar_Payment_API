import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import PaymentMetrics from "./PaymentMetrics";
import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock next-intl
vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
    useLocale: () => "en",
}));

// Mock merchant-store
vi.mock("@/lib/merchant-store", () => ({
    useMerchantApiKey: () => "mock-api-key",
    useMerchantHydrated: () => true,
    useMerchantId: () => "merchant-123",
    useHydrateMerchantStore: vi.fn(),
}));

// Mock ResizeObserver for Recharts
global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
}));

// Mock Recharts to avoid SVG rendering issues in JSDOM
vi.mock("recharts", () => ({
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
    LineChart: ({ children }: any) => <div>{children}</div>,
    Line: () => <div />,
    XAxis: () => <div />,
    YAxis: () => <div />,
    CartesianGrid: () => <div />,
    Tooltip: () => <div />,
    Legend: () => <div />,
}));

describe("PaymentMetrics Component", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    it("renders loading skeleton initially", async () => {
        (global.fetch as any).mockImplementation(() => new Promise(() => { })); // Never resolves

        render(<PaymentMetrics />);

        expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
    });

    it("renders summary metrics after successful fetch", async () => {
        const mockSummary = {
            total_volume: 1500,
            confirmed_count: 42,
            success_rate: 98.5,
            data: []
        };

        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => mockSummary,
        });

        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ assets: [], data: [] }),
        });

        render(<PaymentMetrics />);

        await waitFor(() => {
            expect(screen.getByText("1,500")).toBeInTheDocument();
            expect(screen.getByText("42")).toBeInTheDocument();
            expect(screen.getByText("98.5%")).toBeInTheDocument();
        });
    });

    it("renders error message on fetch failure", async () => {
        (global.fetch as any).mockRejectedValue(new Error("API Error"));

        render(<PaymentMetrics />);

        await waitFor(() => {
            expect(screen.getByText("fetchMetricsFailed")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "retry" })).toBeInTheDocument();
        });
    });

    it("displays 'No payments' message when assets list is empty", async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ total_volume: 0, confirmed_count: 0, success_rate: 0, data: [] }),
        });

        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ assets: [], data: [] }),
        });

        render(<PaymentMetrics />);

        await waitFor(() => {
            expect(screen.getByText("noPayments")).toBeInTheDocument();
        });
    });
});
