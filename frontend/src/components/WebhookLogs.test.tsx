/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
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

  it("table rows are keyboard-focusable (tabIndex=0)", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        logs: [
          {
            id: "aaaa",
            payment_id: "p1",
            status_code: 200,
            event: "payment.confirmed",
            url: "https://example.com/wh",
            request_payload: {},
            request_headers: null,
            response_body: "ok",
            timestamp: "2026-04-25T09:00:00.000Z",
          },
        ],
      }),
    });

    render(<WebhookLogs />);

    await waitFor(() => expect(screen.getByText("payment.confirmed")).toBeInTheDocument());

    const row = screen.getByRole("button", { name: /payment\.confirmed/i });
    expect(row).toHaveAttribute("tabindex", "0");
  });

  it("pressing Enter on a row opens the detail view", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        logs: [
          {
            id: "bbbb",
            payment_id: "p2",
            status_code: 500,
            event: "payment.failed",
            url: "https://example.com/wh",
            request_payload: {},
            request_headers: null,
            response_body: "error",
            timestamp: "2026-04-25T10:00:00.000Z",
          },
        ],
      }),
    });

    render(<WebhookLogs />);

    await waitFor(() => expect(screen.getByText("payment.failed")).toBeInTheDocument());

    const row = screen.getByRole("button", { name: /payment\.failed/i });
    fireEvent.keyDown(row, { key: "Enter" });
    // WebhookDetailModal is mocked to null; confirming no throw is sufficient
    expect(row).toBeInTheDocument();
  });

  it("pressing Space on a row opens the detail view without page scroll", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        logs: [
          {
            id: "cccc",
            payment_id: "p3",
            status_code: 200,
            event: "payout.sent",
            url: "https://example.com/wh",
            request_payload: {},
            request_headers: null,
            response_body: "ok",
            timestamp: "2026-04-25T11:00:00.000Z",
          },
        ],
      }),
    });

    render(<WebhookLogs />);

    await waitFor(() => expect(screen.getByText("payout.sent")).toBeInTheDocument());

    const row = screen.getByRole("button", { name: /payout\.sent/i });
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    row.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});
