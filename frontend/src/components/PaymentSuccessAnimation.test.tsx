import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PaymentSuccessAnimation } from "./PaymentSuccessAnimation";
import { NextIntlClientProvider } from "next-intl";

// Mock framer-motion
jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock canvas-confetti
jest.mock("canvas-confetti", () => jest.fn());

// Mock next-intl
jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      "payment.successAnnounce": "Payment successful! {amount} {asset} has been received.",
      "common.close": "Close",
      "payment.amountReceived": "Amount Received",
      "payment.successMessage": "Your payment has been processed successfully.",
      "payment.transactionId": "Transaction ID",
      "common.continue": "Continue",
      "payment.successHint": "Press the continue button or close button to dismiss this success message.",
    };
    return translations[key] || key;
  },
}));

describe("PaymentSuccessAnimation", () => {
  const defaultProps = {
    show: true,
    onComplete: jest.fn(),
    amount: "100",
    asset: "XLM",
    txId: "tx123",
  };

  const renderComponent = (props = {}) => {
    const messages = {
      "payment.successAnnounce": "Payment successful! {amount} {asset} has been received.",
      "common.close": "Close",
      "payment.amountReceived": "Amount Received",
      "payment.successMessage": "Your payment has been processed successfully.",
      "payment.transactionId": "Transaction ID",
      "common.continue": "Continue",
      "payment.successHint": "Press the continue button or close button to dismiss this success message.",
    };

    return render(
      <NextIntlClientProvider messages={messages} locale="en">
        <PaymentSuccessAnimation {...defaultProps} {...props} />
      </NextIntlClientProvider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders nothing when show is false", () => {
      renderComponent({ show: false });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("renders success animation when show is true", () => {
      renderComponent();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Payment Successful!")).toBeInTheDocument();
      expect(screen.getByText("100 XLM")).toBeInTheDocument();
    });

    it("displays correct amount and asset", () => {
      renderComponent({ amount: "500", asset: "USD" });
      expect(screen.getByText("500 USD")).toBeInTheDocument();
    });

    it("displays transaction ID when provided", () => {
      renderComponent();
      expect(screen.getByText("tx123")).toBeInTheDocument();
    });

    it("does not display transaction ID when not provided", () => {
      renderComponent({ txId: undefined });
      expect(screen.queryByText("Transaction ID")).not.toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    it("has correct ARIA attributes", () => {
      renderComponent();
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby", "payment-success-title");
      expect(dialog).toHaveAttribute("aria-describedby", "payment-success-description");
    });

    it("has screen reader announcement", () => {
      renderComponent();
      const announcement = screen.getByRole("status");
      expect(announcement).toHaveAttribute("aria-live", "assertive");
      expect(announcement).toHaveAttribute("aria-atomic", "true");
      expect(announcement).toHaveTextContent("Payment successful! 100 XLM has been received.");
    });

    it("has accessible close button", () => {
      renderComponent();
      const closeButton = screen.getByLabelText("Close");
      expect(closeButton).toBeInTheDocument();
    });

    it("has accessible continue button", () => {
      renderComponent();
      const continueButton = screen.getByLabelText("Continue");
      expect(continueButton).toBeInTheDocument();
    });

    it("has screen reader hint", () => {
      renderComponent();
      const hint = screen.getByText("Press the continue button or close button to dismiss this success message.");
      expect(hint).toHaveClass("sr-only");
    });
  });

  describe("Interactions", () => {
    it("calls onComplete when close button is clicked", () => {
      renderComponent();
      const closeButton = screen.getByLabelText("Close");
      fireEvent.click(closeButton);
      expect(defaultProps.onComplete).toHaveBeenCalledTimes(1);
    });

    it("calls onComplete when continue button is clicked", () => {
      renderComponent();
      const continueButton = screen.getByLabelText("Continue");
      fireEvent.click(continueButton);
      expect(defaultProps.onComplete).toHaveBeenCalledTimes(1);
    });

    it("calls onComplete after animation timeout", async () => {
      renderComponent();
      await waitFor(() => {
        expect(defaultProps.onComplete).toHaveBeenCalledTimes(1);
      }, { timeout: 4100 });
    });
  });

  describe("Confetti Animation", () => {
    it("triggers confetti on mount when show is true", () => {
      const mockConfetti = require("canvas-confetti");
      renderComponent();
      expect(mockConfetti).toHaveBeenCalled();
    });

    it("does not trigger confetti when show is false", () => {
      const mockConfetti = require("canvas-confetti");
      renderComponent({ show: false });
      expect(mockConfetti).not.toHaveBeenCalled();
    });

    it("does not trigger confetti again on re-render", () => {
      const mockConfetti = require("canvas-confetti");
      const { rerender } = renderComponent();
      rerender(
        <NextIntlClientProvider messages={{}} locale="en">
          <PaymentSuccessAnimation {...defaultProps} show={true} />
        </NextIntlClientProvider>
      );
      expect(mockConfetti).toHaveBeenCalledTimes(1);
    });
  });

  describe("Animation States", () => {
    it("resets announcement state after timeout", async () => {
      renderComponent();
      // First render should set hasAnnounced to true
      await waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Re-render to check if it would announce again
      const { rerender } = render(
        <NextIntlClientProvider messages={{}} locale="en">
          <PaymentSuccessAnimation {...defaultProps} show={false} />
        </NextIntlClientProvider>
      );

      rerender(
        <NextIntlClientProvider messages={{}} locale="en">
          <PaymentSuccessAnimation {...defaultProps} show={true} />
        </NextIntlClientProvider>
      );

      // Should announce again after reset
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  describe("Props Handling", () => {
    it("uses default values for optional props", () => {
      renderComponent({
        show: true,
        onComplete: jest.fn(),
        amount: undefined,
        asset: undefined,
        txId: undefined,
      });
      expect(screen.getByText("0 XLM")).toBeInTheDocument();
    });

    it("handles custom onComplete callback", () => {
      const customOnComplete = jest.fn();
      renderComponent({ onComplete: customOnComplete });

      const continueButton = screen.getByLabelText("Continue");
      fireEvent.click(continueButton);

      expect(customOnComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe("Translation Integration", () => {
    it("uses translated text for UI elements", () => {
      renderComponent();
      expect(screen.getByText("Amount Received")).toBeInTheDocument();
      expect(screen.getByText("Your payment has been processed successfully.")).toBeInTheDocument();
    });

    it("falls back to keys when translations are missing", () => {
      const messages = {};
      const { rerender } = render(
        <NextIntlClientProvider messages={messages} locale="en">
          <PaymentSuccessAnimation {...defaultProps} />
        </NextIntlClientProvider>
      );

      // Should still render with fallback keys
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});