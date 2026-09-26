/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import AnalyticsCards from "./AnalyticsCards";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
}));

vi.mock("@/lib/merchant-store", () => ({
  useMerchantApiKey: () => "mock-api-key",
  useMerchantHydrated: () => true,
  useHydrateMerchantStore: vi.fn(),
}));

vi.mock("@/lib/display-preferences", async () => {
  const actual = await vi.importActual<typeof import("@/lib/display-preferences")>(
    "@/lib/display-preferences"
  );
  return {
    ...actual,
    useDisplayPreferences: () => ({ hideCents: false, setHideCents: vi.fn() }),
  };
});

const METRICS_RESPONSE = { total_volume: 1500 };
const PAYMENTS_RESPONSE = {
  payments: [
    { id: "1", status: "confirmed" },
    { id: "2", status: "confirmed" },
    { id: "3", status: "pending" },
    { id: "4", status: "failed" },
  ],
};

function mockFetchSuccess() {
  (globalThis.fetch as any) = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => METRICS_RESPONSE })
    .mockResolvedValueOnce({ ok: true, json: async () => PAYMENTS_RESPONSE });
}

describe("AnalyticsCards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a loading skeleton before data resolves", () => {
    (globalThis.fetch as any) = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<AnalyticsCards />);
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });

  it("renders the three metric cards after data resolves", async () => {
    mockFetchSuccess();
    render(<AnalyticsCards />);

    await waitFor(() => {
      expect(screen.getByText("Total Volume (7D)")).toBeInTheDocument();
      expect(screen.getByText("Success Rate")).toBeInTheDocument();
      expect(screen.getByText("Active intents")).toBeInTheDocument();
    });
  });

  it("computes success rate from confirmed vs. resolved payments", async () => {
    mockFetchSuccess();
    render(<AnalyticsCards />);

    // 2 confirmed / (2 confirmed + 1 failed) = 66.7%
    await waitFor(() => {
      expect(screen.getByText("66.7%")).toBeInTheDocument();
    });
  });

  it("counts pending payments as active intents", async () => {
    mockFetchSuccess();
    render(<AnalyticsCards />);

    await waitFor(() => {
      const activeIntentsCard = screen.getByText("Active intents").closest("button")!;
      expect(activeIntentsCard).toHaveTextContent("1");
    });
  });

  // ── Focus-trapped detail dialog (#1522) ─────────────────────────────────────

  describe("card detail dialog", () => {
    it("each card is a button that announces it opens a dialog", async () => {
      mockFetchSuccess();
      render(<AnalyticsCards />);

      await waitFor(() => {
        const cards = screen.getAllByRole("button");
        expect(cards).toHaveLength(3);
        cards.forEach((card) => expect(card).toHaveAttribute("aria-haspopup", "dialog"));
      });
    });

    it("opens an accessible dialog with the card's detail when clicked", async () => {
      mockFetchSuccess();
      render(<AnalyticsCards />);

      await waitFor(() => screen.getByText("Total Volume (7D)"));
      fireEvent.click(screen.getByText("Total Volume (7D)").closest("button")!);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveTextContent(/total payment volume processed/i);
    });

    it("dialog is labelled by the card's title", async () => {
      mockFetchSuccess();
      render(<AnalyticsCards />);

      await waitFor(() => screen.getByText("Success Rate"));
      fireEvent.click(screen.getByText("Success Rate").closest("button")!);

      const dialog = screen.getByRole("dialog");
      const labelledBy = dialog.getAttribute("aria-labelledby");
      expect(labelledBy).toBeTruthy();
      expect(document.getElementById(labelledBy!)).toHaveTextContent("Success Rate");
    });

    it("closes the dialog when the close button is clicked", async () => {
      mockFetchSuccess();
      render(<AnalyticsCards />);

      await waitFor(() => screen.getByText("Active intents"));
      fireEvent.click(screen.getByText("Active intents").closest("button")!);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("modal-close"));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("closes the dialog on Escape", async () => {
      mockFetchSuccess();
      render(<AnalyticsCards />);

      await waitFor(() => screen.getByText("Total Volume (7D)"));
      fireEvent.click(screen.getByText("Total Volume (7D)").closest("button")!);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("traps Tab focus within the open dialog", async () => {
      mockFetchSuccess();
      render(<AnalyticsCards />);

      await waitFor(() => screen.getByText("Total Volume (7D)"));
      fireEvent.click(screen.getByText("Total Volume (7D)").closest("button")!);

      const dialog = screen.getByRole("dialog");
      const closeButton = screen.getByTestId("modal-close");

      // Only the close button is focusable inside this dialog's body (plain text detail).
      closeButton.focus();
      expect(document.activeElement).toBe(closeButton);

      fireEvent.keyDown(document, { key: "Tab" });
      expect(document.activeElement).toBe(closeButton);
      void dialog;
    });

    it("restores focus to the triggering card when closed", async () => {
      mockFetchSuccess();
      render(<AnalyticsCards />);

      await waitFor(() => screen.getByText("Total Volume (7D)"));
      const trigger = screen.getByText("Total Volume (7D)").closest("button")!;
      trigger.focus();
      fireEvent.click(trigger);

      fireEvent.keyDown(document, { key: "Escape" });
      expect(document.activeElement).toBe(trigger);
    });
  });
});
