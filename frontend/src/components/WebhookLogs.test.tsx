/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, beforeEach, vi } from "vitest";
import WebhookLogs from "./WebhookLogs";

vi.mock("react-hot-toast", () => ({
  __esModule: true,
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/ui/Button", () => ({
  __esModule: true,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("./WebhookDetailModal", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("@/lib/merchant-store", () => ({
  useHydrateMerchantStore: vi.fn(),
  useMerchantApiKey: () => "mock-api-key",
  useMerchantHydrated: () => true,
}));

describe("WebhookLogs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.fetch = vi.fn();
  });

  it("shows green 200s and red 400s from fetched delivery attempts", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        logs: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            payment_id: "p1",
            status_code: 200,
            event: "payment.confirmed",
            url: "https://merchant.example/webhook",
            request_payload: {},
            request_headers: null,
            response_body: "ok",
            timestamp: "2026-04-25T09:00:00.000Z",
          },
          {
            id: "22222222-2222-2222-2222-222222222222",
            payment_id: "p2",
            status_code: 404,
            event: "payment.failed",
            url: "https://merchant.example/webhook",
            request_payload: {},
            request_headers: null,
            response_body: "not found",
            timestamp: "2026-04-25T09:05:00.000Z",
          },
        ],
      }),
    });

    render(<WebhookLogs />);

    await waitFor(() => {
      expect(screen.getByText("200")).toBeInTheDocument();
      expect(screen.getByText("404")).toBeInTheDocument();
    });

    expect(screen.getByText("200")).toHaveClass("text-green-300");
    expect(screen.getByText("404")).toHaveClass("text-red-300");
  });
});
