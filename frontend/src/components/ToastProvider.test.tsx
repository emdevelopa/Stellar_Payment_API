/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { dynamicCalls, mockToasterRender } = vi.hoisted(() => ({
  dynamicCalls: [] as Array<{ loader: () => Promise<unknown>; options?: Record<string, unknown> }>,
  mockToasterRender: vi.fn(),
}));

vi.mock("next/dynamic", () => ({
  default: vi.fn((loader: () => Promise<unknown>, options?: Record<string, unknown>) => {
    dynamicCalls.push({ loader, options });
    return function MockDynamicToaster(props: Record<string, unknown>) {
      mockToasterRender(props);
      return (
        <section
          data-testid="sonner-toaster"
          aria-label={String(props.containerAriaLabel ?? "Notifications")}
          data-position={String(props.position)}
          data-theme={String(props.theme)}
          data-close-button={String(Boolean(props.closeButton))}
          data-expand={String(Boolean(props.expand))}
          data-gap={String(props.gap)}
          data-visible-toasts={String(props.visibleToasts)}
          data-rich-colors={String(Boolean(props.richColors))}
          data-duration={String((props.toastOptions as { duration?: number } | undefined)?.duration)}
        >
          <ol role="region" aria-live="polite" data-testid="toast-list">
            <li role="status" data-testid="sample-toast">
              <span>Payment confirmed</span>
              {props.closeButton ? (
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={() => {
                    const el = document.querySelector("[data-testid='sample-toast']");
                    el?.setAttribute("data-dismissed", "true");
                  }}
                >
                  Close
                </button>
              ) : null}
            </li>
          </ol>
        </section>
      );
    };
  }),
}));

import ToastProvider, { DEFAULT_TOAST_OPTIONS } from "./ToastProvider";

describe("ToastProvider", () => {
  beforeEach(() => {
    mockToasterRender.mockClear();
  });

  describe("bundle optimization & dynamic import (#1832)", () => {
    it("dynamically imports sonner Toaster with ssr: false and null loading fallback", () => {
      expect(dynamicCalls).toHaveLength(1);
      expect(dynamicCalls[0].options).toMatchObject({ ssr: false });
      const loadingFn = dynamicCalls[0].options?.loading as (() => React.ReactNode) | undefined;
      expect(loadingFn).toBeTypeOf("function");
      expect(loadingFn?.()).toBeNull();
    });

    it("loader resolves the sonner Toaster export", async () => {
      const loaded = await dynamicCalls[0].loader();
      expect(loaded).toBeDefined();
    });
  });

  describe("snapshot tests (#1833)", () => {
    it("matches snapshot with default configuration", () => {
      const { container } = render(<ToastProvider />);
      expect(container.firstChild).toMatchSnapshot();
    });

    it("matches snapshot with custom configuration", () => {
      const { container } = render(
        <ToastProvider
          position="bottom-left"
          theme="light"
          closeButton={false}
          expand
          gap={12}
          visibleToasts={5}
          richColors
          duration={6000}
          containerAriaLabel="Stellar alerts"
        />,
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe("props & user interactions (#1833)", () => {
    it("forwards default toastOptions and accessibility attributes", () => {
      render(<ToastProvider />);
      const toaster = screen.getByTestId("sonner-toaster");
      expect(toaster).toHaveAttribute("aria-label", "Notifications");
      expect(toaster).toHaveAttribute("data-position", "top-right");
      expect(toaster).toHaveAttribute("data-theme", "dark");
      expect(toaster).toHaveAttribute("data-duration", String(DEFAULT_TOAST_OPTIONS.duration));
      expect(mockToasterRender).toHaveBeenCalledWith(
        expect.objectContaining({
          position: "top-right",
          theme: "dark",
          closeButton: true,
          expand: false,
          gap: 8,
          visibleToasts: 3,
          toastOptions: expect.objectContaining({
            duration: 4500,
            style: {
              fontFamily: "var(--font-sans)",
              fontSize: "13.5px",
            },
          }),
        }),
      );
    });

    it("allows dismissing a notification via the close button", () => {
      render(<ToastProvider />);
      const dismissButton = screen.getByRole("button", {
        name: /Dismiss notification/i,
      });
      fireEvent.click(dismissButton);
      expect(screen.getByTestId("sample-toast")).toHaveAttribute(
        "data-dismissed",
        "true",
      );
    });

    it("hides the close button when closeButton={false}", () => {
      render(<ToastProvider closeButton={false} />);
      expect(
        screen.queryByRole("button", { name: /Dismiss notification/i }),
      ).not.toBeInTheDocument();
    });
  });
});
