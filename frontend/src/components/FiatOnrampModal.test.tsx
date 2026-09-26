import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";

import FiatOnrampModal from "./FiatOnrampModal";

const messages = {
  fiatOnramp: {
    title: "Buy / Deposit Funds",
    triggerLabel: "Buy / Deposit",
    description:
      "Deposit fiat via a Stellar anchor (SEP-0024). Funds arrive as tokens directly in your connected wallet.",
    selectAsset: "Select Asset",
    amountLabel: "Amount",
    amountOptional: "(optional)",
    amountPlaceholder: "e.g. {amount} {asset}",
    anchorDomainLabel: "Anchor Domain",
    anchorDomainPlaceholder: "e.g. testanchor.stellar.org",
    continueButton: "Continue to Anchor",
    footerNote: "Secured by Stellar Network - SEP-0024 Standard",
    stepConnecting: "Connecting to anchor...",
    stepAuth: "Waiting for wallet signature...",
    stepGenerating: "Preparing your deposit form...",
    authHint: "Please sign the challenge transaction in your wallet to securely connect to {domain}.",
    genericHint: "This should only take a moment.",
    iframeTitle: "Anchor deposit form",
    genericError: "Deposit failed",
  },
};

function renderModal(props: { isOpen: boolean; onClose: () => void }) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FiatOnrampModal {...props} />
    </NextIntlClientProvider>,
  );
}

// ─── framer-motion mock ───────────────────────────────────────────────────────
// jsdom has no layout engine so framer-motion's measurement APIs fail; strip
// animation-only props and render plain HTML so the DOM stays inspectable.
vi.mock("framer-motion", () => {
  const strip = (props: Record<string, unknown>) => {
    const { initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props;
    return rest;
  };
  return {
    motion: {
      div: ({ children, ...p }: any) => <div {...strip(p)}>{children}</div>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockGetFreighterPublicKey = vi.fn();
const mockSignWithFreighter = vi.fn();
vi.mock("@/lib/freighter", () => ({
  getFreighterPublicKey: (...args: unknown[]) => mockGetFreighterPublicKey(...args),
  signWithFreighter: (...args: unknown[]) => mockSignWithFreighter(...args),
}));

const mockGetAnchorServices = vi.fn();
const mockAuthenticateWithAnchor = vi.fn();
const mockInitiateDeposit = vi.fn();
vi.mock("@/lib/stellar", () => ({
  getAnchorServices: (...args: unknown[]) => mockGetAnchorServices(...args),
  authenticateWithAnchor: (...args: unknown[]) => mockAuthenticateWithAnchor(...args),
  initiateDeposit: (...args: unknown[]) => mockInitiateDeposit(...args),
}));

describe("FiatOnrampModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFreighterPublicKey.mockResolvedValue("GABC123PUBLICKEY");
    mockGetAnchorServices.mockResolvedValue({
      transferServer: "https://anchor.example/sep24",
      webAuthEndpoint: "https://anchor.example/auth",
      signingKey: "GSIGNINGKEY",
    });
    mockSignWithFreighter.mockResolvedValue({ signedXDR: "signed-xdr" });
    mockAuthenticateWithAnchor.mockResolvedValue("jwt-token");
    mockInitiateDeposit.mockResolvedValue("https://anchor.example/interactive/abc");
  });

  it("does not render when closed", () => {
    renderModal({ isOpen: false, onClose: vi.fn() });
    expect(screen.queryByText("Buy / Deposit Funds")).not.toBeInTheDocument();
  });

  it("renders the asset selection form when open", () => {
    renderModal({ isOpen: true, onClose: vi.fn() });
    expect(screen.getByText("Buy / Deposit Funds")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /USDC/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SRT/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to Anchor" })).toBeInTheDocument();
  });

  it("lets the user switch the selected asset", () => {
    renderModal({ isOpen: true, onClose: vi.fn() });
    const usdcButton = screen.getByRole("button", { name: /USDC/ });
    const srtButton = screen.getByRole("button", { name: /SRT/ });

    expect(usdcButton).toHaveAttribute("aria-pressed", "true");
    expect(srtButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(srtButton);

    expect(srtButton).toHaveAttribute("aria-pressed", "true");
    expect(usdcButton).toHaveAttribute("aria-pressed", "false");
  });

  it("walks through connecting, auth, and generating loading states before showing the interactive iframe", async () => {
    renderModal({ isOpen: true, onClose: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Continue to Anchor" }));

    await waitFor(() => {
      expect(mockGetFreighterPublicKey).toHaveBeenCalled();
      expect(mockGetAnchorServices).toHaveBeenCalledWith("testanchor.stellar.org");
    });

    await waitFor(() => {
      expect(mockAuthenticateWithAnchor).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockInitiateDeposit).toHaveBeenCalledWith(
        "https://anchor.example/sep24",
        "jwt-token",
        "USDC",
        "GABC123PUBLICKEY",
        undefined,
      );
    });

    await waitFor(() => {
      expect(screen.getByTitle("Anchor deposit form")).toBeInTheDocument();
    });
  });

  it("passes the entered amount through to initiateDeposit", async () => {
    renderModal({ isOpen: true, onClose: vi.fn() });

    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to Anchor" }));

    await waitFor(() => {
      expect(mockInitiateDeposit).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        "USDC",
        "GABC123PUBLICKEY",
        "250",
      );
    });
  });

  it("shows an inline error and returns to the select step when the wallet is unavailable", async () => {
    mockGetFreighterPublicKey.mockRejectedValue(new Error("Freighter is not installed"));

    renderModal({ isOpen: true, onClose: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Continue to Anchor" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Freighter is not installed");
    });

    expect(screen.getByRole("button", { name: "Continue to Anchor" })).toBeInTheDocument();
    expect(mockGetAnchorServices).not.toHaveBeenCalled();
  });

  it("resets state and calls onClose when closed", () => {
    const onClose = vi.fn();
    renderModal({ isOpen: true, onClose });

    fireEvent.click(screen.getByTestId("modal-close"));

    expect(onClose).toHaveBeenCalled();
  });

  describe("WCAG 2.1 AA — ARIA attributes", () => {
    it("dialog container has role=dialog and aria-modal=true", () => {
      renderModal({ isOpen: true, onClose: vi.fn() });
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    it("dialog is labelled by the modal title", () => {
      renderModal({ isOpen: true, onClose: vi.fn() });
      const dialog = screen.getByRole("dialog");
      const labelledById = dialog.getAttribute("aria-labelledby");
      expect(labelledById).toBeTruthy();
      const titleEl = document.getElementById(labelledById!);
      expect(titleEl).toHaveTextContent("Buy / Deposit Funds");
    });

    it("dialog has aria-describedby pointing at the description paragraph", () => {
      renderModal({ isOpen: true, onClose: vi.fn() });
      const dialog = screen.getByRole("dialog");
      const describedById = dialog.getAttribute("aria-describedby");
      expect(describedById).toBeTruthy();
      const descEl = document.getElementById(describedById!);
      expect(descEl).toHaveTextContent(/Deposit fiat via a Stellar anchor/i);
    });

    it("submit button exposes aria-busy=false at rest and aria-busy=true while busy", async () => {
      renderModal({ isOpen: true, onClose: vi.fn() });
      const continueBtn = screen.getByRole("button", { name: "Continue to Anchor" });
      expect(continueBtn).toHaveAttribute("aria-busy", "false");

      fireEvent.click(continueBtn);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Connecting|Waiting|Preparing/i })).toHaveAttribute(
          "aria-busy",
          "true",
        );
      });
    });

    it("close button has a descriptive aria-label", () => {
      renderModal({ isOpen: true, onClose: vi.fn() });
      expect(
        screen.getByRole("button", { name: /close buy \/ deposit funds/i }),
      ).toBeInTheDocument();
    });
  });

  it("asset group has role=group and accessible label", () => {
    renderModal({ isOpen: true, onClose: vi.fn() });
    expect(screen.getByRole("group", { name: "Select Asset" })).toBeInTheDocument();
  });

  it("ArrowRight on USDC selects SRT", () => {
    renderModal({ isOpen: true, onClose: vi.fn() });
    const usdcButton = screen.getByRole("button", { name: /USDC/ });
    const srtButton = screen.getByRole("button", { name: /SRT/ });

    expect(usdcButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(usdcButton, { key: "ArrowRight" });
    expect(srtButton).toHaveAttribute("aria-pressed", "true");
    expect(usdcButton).toHaveAttribute("aria-pressed", "false");
  });

  it("ArrowLeft on USDC wraps to SRT", () => {
    renderModal({ isOpen: true, onClose: vi.fn() });
    const usdcButton = screen.getByRole("button", { name: /USDC/ });
    const srtButton = screen.getByRole("button", { name: /SRT/ });

    expect(usdcButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(usdcButton, { key: "ArrowLeft" });
    expect(srtButton).toHaveAttribute("aria-pressed", "true");
    expect(usdcButton).toHaveAttribute("aria-pressed", "false");
  });
});
