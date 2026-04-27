/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import CreatePaymentForm from "./CreatePaymentForm";

const { mockConfetti, mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockConfetti: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    React.createElement("a", { href, ...props }, children)
  ),
}));

vi.mock("framer-motion", async () => {
  const ReactModule = await import("react");

  const motion = new Proxy(
    {},
    {
      get: (_, tag: string) =>
        ReactModule.forwardRef(function MockMotion(
          { children, ...props }: any,
          ref,
        ) {
          return ReactModule.createElement(tag, { ...props, ref }, children);
        }),
    },
  );

  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock("canvas-confetti", () => ({
  default: mockConfetti,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

vi.mock("./CopyButton", () => ({
  default: ({ text }: { text: string }) =>
    React.createElement("button", { type: "button" }, `copy ${text}`),
}));

vi.mock("./IntegrationCodeSnippets", () => ({
  default: () => React.createElement("div", null, "integration-code"),
}));

vi.mock("./InfoTooltip", () => ({
  InfoTooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/lib/merchant-store", () => ({
  useHydrateMerchantStore: vi.fn(),
  useMerchantApiKey: () => "sk_test_123",
  useMerchantHydrated: () => true,
  useMerchantTrustedAddresses: () => [],
}));

describe("CreatePaymentForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    global.fetch = vi.fn();
  });

  it("shows the success animation state after submit and clears the draft on reset", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        payment_id: "pay_123",
        payment_link: "https://example.com/pay/pay_123",
        status: "pending",
      }),
    });

    const { container } = render(React.createElement(CreatePaymentForm));

    fireEvent.change(container.querySelector("#amount")!, {
      target: { value: "25" },
    });
    fireEvent.change(container.querySelector("#recipient")!, {
      target: { value: `G${"A".repeat(55)}` },
    });

    fireEvent.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(screen.getByText("readyTitle")).toBeInTheDocument();
    });

    expect(screen.getByText("https://example.com/pay/pay_123")).toBeInTheDocument();
    expect(mockToastSuccess).toHaveBeenCalledWith("createdToast");
    expect(mockConfetti).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "createAnother" }));

    await waitFor(() => {
      expect(container.querySelector("#amount")).toHaveValue(null);
    });

    expect(container.querySelector("#recipient")).toHaveValue("");
    expect(localStorage.getItem("payment_amount")).toBeNull();
    expect(localStorage.getItem("payment_recipient")).toBeNull();
  });
});
