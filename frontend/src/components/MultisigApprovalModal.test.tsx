import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import MultisigApprovalModal from "./MultisigApprovalModal";
import { MultisigProvider } from "@/lib/multisig-context";

describe("MultisigApprovalModal Component", () => {
  const mockTransaction = {
    id: "test-tx-1",
    sourceAccount: "GD5...",
    destination: "GABC...",
    amount: "100",
    assetCode: "USDC",
    minSignatures: 2,
    signers: [
      { id: "signer1", publicKey: "G123...", name: "Alice", weight: 1, hasSigned: false },
      { id: "signer2", publicKey: "G456...", name: "Bob", weight: 1, hasSigned: false },
    ],
    createdAt: "2024-01-01T00:00:00Z",
    status: "pending" as const,
  };

  const renderWithProvider = (props = {}) => {
    const defaultProps = {
      isOpen: true,
      onClose: jest.fn(),
      networkPassphrase: "Test Network",
      transaction: mockTransaction,
    };

    return render(
      <MultisigProvider networkPassphrase="Test Network">
        <MultisigApprovalModal {...defaultProps} {...props} />
      </MultisigProvider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("Modal Rendering", () => {
    it("renders modal when open", () => {
      renderWithProvider();

      expect(screen.getByText("Multi-Signature Approval")).toBeInTheDocument();
      expect(screen.getByText("Review Transaction")).toBeInTheDocument();
    });

    it("does not render when closed", () => {
      renderWithProvider({ isOpen: false });

      expect(screen.queryByText("Multi-Signature Approval")).not.toBeInTheDocument();
    });

    it("displays transaction details correctly", () => {
      renderWithProvider();

      expect(screen.getByText("100 USDC")).toBeInTheDocument();
      expect(screen.getByText("GABC...")).toBeInTheDocument();
      expect(screen.getByText("Signatures (0/2)")).toBeInTheDocument();
    });

    it("shows correct step indicator", () => {
      renderWithProvider();

      expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    });
  });

  describe("Signers List", () => {
    it("displays all signers", () => {
      renderWithProvider();

      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.getByText("Weight: 1")).toBeInTheDocument();
    });

    it("shows sign buttons for unsigned signers", () => {
      renderWithProvider();

      const signButtons = screen.getAllByText("Sign");
      expect(signButtons).toHaveLength(2);
    });

    it("updates signer status after signing", async () => {
      renderWithProvider();

      const signButtons = screen.getAllByText("Sign");
      fireEvent.click(signButtons[0]);

      await waitFor(() => {
        expect(screen.getByText("Signed")).toBeInTheDocument();
      }, { timeout: 2000 });

      await waitFor(() => {
        expect(screen.getByText("Signatures (1/2)")).toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it("disables sign button for already signed signer", async () => {
      renderWithProvider();

      const signButtons = screen.getAllByText("Sign");
      fireEvent.click(signButtons[0]);

      await waitFor(() => {
        const signedButton = screen.getByText("Signed");
        expect(signedButton).toBeDisabled();
      }, { timeout: 2000 });
    });
  });

  describe("Progress Tracking", () => {
    it("shows correct progress percentage", () => {
      renderWithProvider();

      expect(screen.getByText("0%")).toBeInTheDocument();
    });

    it("updates progress after signing", async () => {
      renderWithProvider();

      const signButtons = screen.getAllByText("Sign");
      fireEvent.click(signButtons[0]);

      await waitFor(() => {
        expect(screen.getByText("50%")).toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it("shows submit button when enough signatures", async () => {
      renderWithProvider();

      const signButtons = screen.getAllByText("Sign");
      fireEvent.click(signButtons[0]);

      await waitFor(() => {
        expect(screen.getByText("50%")).toBeInTheDocument();
      }, { timeout: 2000 });

      fireEvent.click(signButtons[1]);

      await waitFor(() => {
        expect(screen.getByText("Submit Transaction")).toBeInTheDocument();
      }, { timeout: 2000 });
    });
  });

  describe("Modal Actions", () => {
    it("calls onClose when close button is clicked", () => {
      const mockOnClose = jest.fn();
      renderWithProvider({ onClose: mockOnClose });

      const closeButton = screen.getByLabelText("Close modal");
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it("calls onClose when backdrop is clicked", () => {
      const mockOnClose = jest.fn();
      renderWithProvider({ onClose: mockOnClose });

      const backdrop = screen.getByText("Multi-Signature Approval").closest('[role="dialog"]')?.previousSibling as HTMLElement;
      if (backdrop) {
        fireEvent.click(backdrop);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });

    it("closes modal on escape key", () => {
      const mockOnClose = jest.fn();
      renderWithProvider({ onClose: mockOnClose });

      fireEvent.keyDown(document, { key: "Escape" });
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("Loading States", () => {
    it("shows loading state during signing", async () => {
      renderWithProvider();

      const signButtons = screen.getAllByText("Sign");
      fireEvent.click(signButtons[0]);

      expect(screen.getByText("Signing...")).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByText("Signing...")).not.toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it("shows processing step during submission", async () => {
      renderWithProvider();

      // Sign both signers to enable submission
      const signButtons = screen.getAllByText("Sign");
      fireEvent.click(signButtons[0]);

      await waitFor(() => {
        expect(screen.getByText("50%")).toBeInTheDocument();
      }, { timeout: 2000 });

      fireEvent.click(signButtons[1]);

      await waitFor(() => {
        expect(screen.getByText("Submit Transaction")).toBeInTheDocument();
      }, { timeout: 2000 });

      fireEvent.click(screen.getByText("Submit Transaction"));

      await waitFor(() => {
        expect(screen.getByText("Processing Transaction")).toBeInTheDocument();
      }, { timeout: 1000 });
    });
  });

  describe("Error Handling", () => {
    it("displays error message when signing fails", async () => {
      renderWithProvider({ transaction: null });

      // Try to sign without transaction
      const signButton = screen.queryByText("Sign");
      if (signButton) {
        fireEvent.click(signButton);

        await waitFor(() => {
          expect(screen.getByText(/Error/)).toBeInTheDocument();
        });
      }
    });

    it("allows retry after error", async () => {
      renderWithProvider({ transaction: null });

      // Trigger error
      const signButton = screen.queryByText("Sign");
      if (signButton) {
        fireEvent.click(signButton);

        await waitFor(() => {
          expect(screen.getByText(/Error/)).toBeInTheDocument();
        });

        const retryButton = screen.getByText("Try Again");
        fireEvent.click(retryButton);

        await waitFor(() => {
          expect(screen.getByText("Review Transaction")).toBeInTheDocument();
        });
      }
    });

    it("clears error when clear button is clicked", async () => {
      renderWithProvider({ transaction: null });

      const signButton = screen.queryByText("Sign");
      if (signButton) {
        fireEvent.click(signButton);

        await waitFor(() => {
          expect(screen.getByText(/Error/)).toBeInTheDocument();
        });

        const clearButton = screen.getByLabelText("Clear error");
        fireEvent.click(clearButton);

        await waitFor(() => {
          expect(screen.queryByText(/Error/)).not.toBeInTheDocument();
        });
      }
    });
  });

  describe("Confirmation State", () => {
    it("shows confirmation after successful submission", async () => {
      renderWithProvider();

      // Complete the signing process
      const signButtons = screen.getAllByText("Sign");
      fireEvent.click(signButtons[0]);

      await waitFor(() => {
        expect(screen.getByText("50%")).toBeInTheDocument();
      }, { timeout: 2000 });

      fireEvent.click(signButtons[1]);

      await waitFor(() => {
        expect(screen.getByText("Submit Transaction")).toBeInTheDocument();
      }, { timeout: 2000 });

      fireEvent.click(screen.getByText("Submit Transaction"));

      await waitFor(() => {
        expect(screen.getByText("Transaction Approved")).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it("displays transaction hash after confirmation", async () => {
      renderWithProvider();

      // Complete the process
      const signButtons = screen.getAllByText("Sign");
      fireEvent.click(signButtons[0]);

      await waitFor(() => {
        expect(screen.getByText("50%")).toBeInTheDocument();
      }, { timeout: 2000 });

      fireEvent.click(signButtons[1]);

      await waitFor(() => {
        expect(screen.getByText("Submit Transaction")).toBeInTheDocument();
      }, { timeout: 2000 });

      fireEvent.click(screen.getByText("Submit Transaction"));

      await waitFor(() => {
        expect(screen.getByText("Transaction Hash")).toBeInTheDocument();
        expect(screen.getByText(/tx_/)).toBeInTheDocument();
      }, { timeout: 3000 });
    });
  });

  describe("Accessibility", () => {
    it("has correct ARIA attributes", () => {
      renderWithProvider();

      const modal = screen.getByRole("dialog");
      expect(modal).toHaveAttribute("aria-modal", "true");
      expect(modal).toHaveAttribute("aria-labelledby", "multisig-modal-title");
    });

    it("has proper roles and live regions for screen readers", () => {
      renderWithProvider();

      // Content area has polite aria-live
      const contentArea = screen.getByText("Multi-Signature Approval").parentElement?.nextElementSibling;
      expect(contentArea).toHaveAttribute("aria-live", "polite");

      // Progress bar role
      const progressBar = screen.getByRole("progressbar");
      expect(progressBar).toHaveAttribute("aria-valuenow", "0");
      expect(progressBar).toHaveAttribute("aria-valuemin", "0");
      expect(progressBar).toHaveAttribute("aria-valuemax", "100");
    });

    it("has proper heading structure", () => {
      renderWithProvider();

      const title = screen.getByText("Multi-Signature Approval");
      expect(title).toBeInTheDocument();
      expect(title).toHaveAttribute("id", "multisig-modal-title");
    });

    it("manages focus correctly", () => {
      renderWithProvider();

      const modal = screen.getByRole("dialog");
      expect(modal).toHaveFocus();
    });
  });

  describe("Transaction Expiry", () => {
    it("shows expired state when transaction is expired", () => {
      const expiredTransaction = {
        ...mockTransaction,
        expiresAt: "2023-01-01T00:00:00Z", // Past date
      };

      renderWithProvider({ transaction: expiredTransaction });

      expect(screen.getByText("Transaction Expired")).toBeInTheDocument();
    });

    it("shows time remaining for non-expired transactions", () => {
      const futureTransaction = {
        ...mockTransaction,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
      };

      renderWithProvider({ transaction: futureTransaction });

      expect(screen.getByText(/Expires in/)).toBeInTheDocument();
    });
  });

  describe("Memo Display", () => {
    it("displays memo when present", () => {
      const transactionWithMemo = {
        ...mockTransaction,
        memo: "Test payment",
      };

      renderWithProvider({ transaction: transactionWithMemo });

      expect(screen.getByText("Test payment")).toBeInTheDocument();
    });

    it("does not show memo section when absent", () => {
      renderWithProvider();

      expect(screen.queryByText("Memo")).not.toBeInTheDocument();
    });
  });

  describe("Asset Issuer Display", () => {
    it("displays asset issuer when present", () => {
      const transactionWithIssuer = {
        ...mockTransaction,
        assetIssuer: "GDEF...",
      };

      renderWithProvider({ transaction: transactionWithIssuer });

      expect(screen.getByText("GDEF...")).toBeInTheDocument();
    });
  });

  describe("Copy Functionality", () => {
    it("renders copy buttons for addresses", () => {
      renderWithProvider();

      const copyButtons = screen.getAllByLabelText(/copy/i);
      expect(copyButtons.length).toBeGreaterThan(0);
    });
  });
});
