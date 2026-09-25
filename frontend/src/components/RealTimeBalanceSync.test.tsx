import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import axe from "axe-core";
import { RealTimeBalanceSync } from "./RealTimeBalanceSync";

vi.mock("next-intl", () => {
  const translations: Record<string, string> = {
    "realTimeBalanceSync.title": "Real-time Balances",
    "realTimeBalanceSync.refreshButton": "Refresh",
    "realTimeBalanceSync.syncing": "Syncing…",
    "realTimeBalanceSync.sectionAriaLabel": "Real-time balance information",
    "realTimeBalanceSync.balancesListAriaLabel": "Account balances",
    "realTimeBalanceSync.emptyState": "No balances available.",
    "realTimeBalanceSync.updatedLabel": "Updated",
    "realTimeBalanceSync.balanceItemAriaLabel": "{asset} balance: {balance}",
    "realTimeBalanceSync.liveRegion.syncing": "Syncing balances…",
    "realTimeBalanceSync.liveRegion.error": "Balance sync error: {error}",
    "realTimeBalanceSync.liveRegion.updatedAt": "Balances updated at {time}.",
  };

  return {
    __esModule: true,
    useTranslations: (namespace: string) => (key: string, params?: Record<string, string>) => {
      const template = translations[`${namespace}.${key}`] ?? key;
      if (!params) return template;
      return Object.entries(params).reduce(
        (result, [paramKey, paramValue]) =>
          result.replace(`{${paramKey}}`, String(paramValue)),
        template,
      );
    },
    useLocale: () => "en",
  };
});

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual("framer-motion");
  return {
    ...actual,
    motion: {
      section: ({ children, variants, initial, animate, exit, layout, whileTap, ...props }: any) =>
        React.createElement("section", props, children),
      button: ({ children, whileTap, whileHover, ...props }: any) =>
        React.createElement("button", props, children),
      p: ({ children, variants, initial, animate, exit, ...props }: any) =>
        React.createElement("p", props, children),
      ul: ({ children, variants, initial, animate, ...props }: any) =>
        React.createElement("ul", props, children),
      li: ({ children, variants, initial, animate, exit, layout, ...props }: any) =>
        React.createElement("li", props, children),
      span: ({ children, variants, initial, animate, transition, ...props }: any) =>
        React.createElement("span", props, children),
      div: ({ children, variants, initial, animate, exit, transition, whileHover, ...props }: any) =>
        React.createElement("div", props, children),
      svg: ({ children, variants, initial, animate, exit, transition, ...props }: any) =>
        React.createElement("svg", props, children),
    },
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => false,
  };
});

const mockBalances = [
  { code: "XLM", balance: "100.50" },
  { code: "USDC", balance: "250.00" },
];

describe("RealTimeBalanceSync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders heading and refresh button", () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balances: [] }),
    });

    render(
      <RealTimeBalanceSync merchantId="m1" apiKey="k1" pollingInterval={0} />
    );

    expect(screen.getByText("Real-time Balances")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
  });

  it("displays balances from server", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balances: mockBalances }),
    });

    render(
      <RealTimeBalanceSync merchantId="m1" apiKey="k1" pollingInterval={0} />
    );

    await waitFor(() => {
      expect(screen.getByText("XLM")).toBeInTheDocument();
      expect(screen.getByText("USDC")).toBeInTheDocument();
    });

    expect(screen.getByText("100.50")).toBeInTheDocument();
    expect(screen.getByText("250.00")).toBeInTheDocument();
  });

  it("shows syncing state while loading", async () => {
    global.fetch = vi.fn().mockImplementation(
      () => new Promise(() => {})
    );

    render(
      <RealTimeBalanceSync merchantId="m1" apiKey="k1" pollingInterval={0} />
    );

    expect(screen.getByText("Syncing\u2026")).toBeInTheDocument();
  });

  it("shows error state when fetch fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    render(
      <RealTimeBalanceSync merchantId="m1" apiKey="k1" pollingInterval={0} />
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/network error/i);
    });
  });

  it("shows empty state when no balances", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balances: [] }),
    });

    render(
      <RealTimeBalanceSync merchantId="m1" apiKey="k1" pollingInterval={0} />
    );

    await waitFor(() => {
      expect(screen.getByText("No balances available.")).toBeInTheDocument();
    });
  });

  it("shows last updated time after successful fetch", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balances: mockBalances }),
    });

    render(
      <RealTimeBalanceSync merchantId="m1" apiKey="k1" pollingInterval={0} />
    );

    await waitFor(() => {
      expect(screen.getByText("Updated")).toBeInTheDocument();
      expect(
        screen.getByText(/\d{1,2}:\d{2} (AM|PM)/, { selector: "time" }),
      ).toBeInTheDocument();
    });
  });

  it("includes aria-live region for screen readers", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balances: mockBalances }),
    });

    render(
      <RealTimeBalanceSync merchantId="m1" apiKey="k1" pollingInterval={0} />
    );

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveAttribute("role", "status");
  });

  it("calls refresh when refresh button is clicked", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balances: mockBalances }),
    });

    render(
      <RealTimeBalanceSync merchantId="m1" apiKey="k1" pollingInterval={5000} />
    );

    await waitFor(() => {
      expect(screen.getByText("XLM")).toBeInTheDocument();
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balances: [{ code: "BTC", balance: "1.5" }] }),
    });

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => {
      expect(screen.getByText("BTC")).toBeInTheDocument();
    });
  });

  it("marks section as aria-busy when loading", () => {
    global.fetch = vi.fn().mockImplementation(
      () => new Promise(() => {})
    );

    render(
      <RealTimeBalanceSync merchantId="m1" apiKey="k1" pollingInterval={0} />
    );

    const section = screen.getByLabelText("Real-time balance information");
    expect(section).toHaveAttribute("aria-busy", "true");
  });

  it("does not clip long balance values on narrow layouts", async () => {
    // A balance formatted to 7 decimal places (the component's max) is long
    // enough to overflow a narrow row if it isn't allowed to wrap — the
    // parent list has overflow-hidden, so a fixed-width, non-wrapping value
    // would be silently cut off rather than visibly reflowing.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        balances: [{ code: "XLM", balance: "1234567.1234567" }],
      }),
    });

    render(
      <RealTimeBalanceSync merchantId="m1" apiKey="k1" pollingInterval={0} />
    );

    const balanceValue = await screen.findByText("1,234,567.1234567");
    expect(balanceValue.className).toEqual(
      expect.stringContaining("break-all"),
    );
    expect(balanceValue.className).not.toEqual(
      expect.stringContaining("truncate"),
    );

    const row = balanceValue.closest("li");
    expect(row?.className).toEqual(expect.stringContaining("flex-wrap"));
  });

  describe("accessibility (axe-core)", () => {
    // color-contrast requires real CSS layout/paint, which jsdom does not
    // perform — Tailwind classes are present but never resolved to computed
    // styles, so axe can only report false positives/negatives for that
    // rule here. Every other rule operates on markup/ARIA semantics, which
    // jsdom does support faithfully.
    const axeOptions = {
      rules: { "color-contrast": { enabled: false } },
    };

    it("has no axe violations in the loaded (with balances) state", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ balances: mockBalances }),
      });

      const { container } = render(
        <RealTimeBalanceSync merchantId="m1" apiKey="k1" pollingInterval={0} />
      );

      await waitFor(() => {
        expect(screen.getByText("XLM")).toBeInTheDocument();
      });

      const results = await axe.run(container, axeOptions);
      expect(results.violations).toEqual([]);
    });

    it("has no axe violations in the empty state", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ balances: [] }),
      });

      const { container } = render(
        <RealTimeBalanceSync merchantId="m1" apiKey="k1" pollingInterval={0} />
      );

      await waitFor(() => {
        expect(screen.getByText("No balances available.")).toBeInTheDocument();
      });

      const results = await axe.run(container, axeOptions);
      expect(results.violations).toEqual([]);
    });

    it("has no axe violations in the error state", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const { container } = render(
        <RealTimeBalanceSync merchantId="m1" apiKey="k1" pollingInterval={0} />
      );

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });

      const results = await axe.run(container, axeOptions);
      expect(results.violations).toEqual([]);
    });

    it("has no axe violations in the loading (skeleton) state", async () => {
      global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

      const { container } = render(
        <RealTimeBalanceSync merchantId="m1" apiKey="k1" pollingInterval={0} />
      );

      const results = await axe.run(container, axeOptions);
      expect(results.violations).toEqual([]);
    });
  });
});
