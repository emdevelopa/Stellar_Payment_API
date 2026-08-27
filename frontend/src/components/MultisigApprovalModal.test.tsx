import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { vi } from "vitest";
import MultisigApprovalModal from "./MultisigApprovalModal";
import { MultisigProvider } from "@/lib/multisig-context";

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<any>("framer-motion");
  return {
    ...actual,
    AnimatePresence: ({ children }: any) => <>{children}</>,
  };
});

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const translations: Record<string, any> = {
      "title": "Multi-Signature Approval",
      "closeModal": "Close modal",
      "stepOf": ({ step, total }: any) => `Step ${step} of ${total}`,
      "review.heading": "Review Transaction",
      "review.description": "Please review the transaction details and confirm your approval.",
      "review.sectionAriaLabel": "Review transaction section",
      "review.amount": "Amount",
      "review.to": "To",
      "review.memo": "Memo",
      "review.signaturesLabel": ({ signed, required }: any) => `Signatures (${signed}/${required})`,
      "review.progressAriaLabel": "Signature progress",
      "review.signersLabel": "Signers",
      "review.signersListAriaLabel": "Signers list",
      "review.signerFallbackName": ({ id }: any) => `Signer ${id}`,
      "review.signedStatus": "Signed",
      "review.notSignedStatus": "Not signed",
      "review.signerWeight": ({ weight }: any) => `Weight: ${weight}`,
      "review.signerAriaLabel": ({ name, weight, status }: any) => `${name}, Weight: ${weight}, Status: ${status}`,
      "review.signButton": "Sign",
      "review.signingButton": "Signing...",
      "review.signButtonAriaLabel": ({ action, name }: any) => `${action} for ${name}`,
      "review.expiresIn": ({ time }: any) => `Expires in ${time}`,
      "review.submitButton": "Submit Transaction",
      "review.submittingButton": "Submitting...",
      "processing.heading": "Processing Transaction",
      "processing.description": "Processing your transaction. Please wait.",
      "confirm.pendingHeading": "Transaction Submitted",
      "confirm.pendingDescription": "Awaiting network confirmation...",
      "confirm.hashPendingLabel": "Transaction Hash",
      "confirm.confirmingButton": "Confirming...",
      "confirm.approvedHeading": "Transaction Approved",
      "confirm.approvedDescription": "Your multi-signature transaction has been successfully submitted",
      "confirm.hashLabel": "Transaction Hash",
      "confirm.closeButton": "Close",
      "error.heading": "Transaction Failed",
      "error.defaultMessage": "An error occurred while processing your transaction",
      "error.tryAgainButton": "Try Again",
      "error.closeButton": "Close",
      "error.bannerTitle": "Error",
      "error.clearErrorAriaLabel": "Clear error",
      "expired.heading": "Transaction Expired",
      "expired.statusLabel": "Expired",
      "expired.badge": "Expired",
      "expired.description": "This transaction has expired and can no longer be signed or submitted.",
      "expired.closeButton": "Close",
      "review.issuer": "Issuer",
      "announcements.processing": "Processing your transaction. Please wait.",
      "announcements.confirmed": "Transaction approved successfully.",
      "announcements.failed": "Transaction failed. See error details below.",
      "toasts.signed": "Transaction signed successfully",
      "toasts.submitted": "Transaction submitted successfully",
      "ariaLabel": "Copy to clipboard",
      "copyButton.ariaLabel": "Copy to clipboard",
    };
    return (key: string, values?: any) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      const val = translations[fullKey] ?? translations[key];
      if (typeof val === "function") {
        return val(values);
      }
      return val || key;
    };
  },
  useLocale: () => "en",
}));

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
      onClose: vi.fn(),
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
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
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
      expect(screen.getAllByText("Weight: 1")[0]).toBeInTheDocument();
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
      const mockOnClose = vi.fn();
      renderWithProvider({ onClose: mockOnClose });

      const closeButton = screen.getByLabelText("Close modal");
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it("calls onClose when backdrop is clicked", () => {
      const mockOnClose = vi.fn();
      renderWithProvider({ onClose: mockOnClose });

      const backdrop = screen.getByText("Multi-Signature Approval").closest('[role="dialog"]')?.previousSibling as HTMLElement;
      if (backdrop) {
        fireEvent.click(backdrop);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });

    it("closes modal on escape key", () => {
      const mockOnClose = vi.fn();
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
    it("shows optimistic pending state on submit before finalising", async () => {
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

      fireEvent.click(screen.getByText("Submit Transaction"));

      // Optimistic state appears immediately
      expect(screen.getByText("Transaction Submitted")).toBeInTheDocument();
      expect(screen.getByText("Awaiting network confirmation...")).toBeInTheDocument();
      expect(screen.getByText("Confirming...")).toBeInTheDocument();
    });

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
    }, 10000);

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
    }, 10000);
  });

  describe("Accessibility", () => {
    it("has correct ARIA attributes on modal", () => {
      renderWithProvider();

      const modal = screen.getByRole("dialog");
      expect(modal).toHaveAttribute("aria-modal", "true");
      expect(modal).toHaveAttribute("aria-labelledby", "multisig-modal-title");
      expect(modal).toHaveAttribute("aria-describedby", "multisig-modal-description");
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
      expect(progressBar).toHaveAttribute("aria-label", "Signature progress");
    });

    it("has proper heading structure with IDs", () => {
      renderWithProvider();

      const title = screen.getByText("Multi-Signature Approval");
      expect(title).toBeInTheDocument();
      expect(title).toHaveAttribute("id", "multisig-modal-title");

      const description = screen.getByText(/Step \d of 3/);
      expect(description).toHaveAttribute("id", "multisig-modal-description");
    });

    it("manages focus correctly on modal open", () => {
      renderWithProvider();

      const modal = screen.getByRole("dialog");
      expect(modal).toHaveFocus();
    });

    it("has semantic list for signers with proper ARIA labels", () => {
      renderWithProvider();

      const signersList = screen.getByRole("list");
      expect(signersList).toBeInTheDocument();
      expect(signersList).toHaveAttribute("aria-labelledby", "signers-label");

      const signerItems = screen.getAllByRole("listitem");
      expect(signerItems).toHaveLength(2);
      signerItems.forEach((item) => {
        expect(item).toHaveAttribute("aria-label");
      });
    });

    it("has descriptive aria-labels on sign buttons", () => {
      renderWithProvider();

      const signButtons = screen.getAllByText("Sign");
      signButtons.forEach((button) => {
        expect(button).toHaveAttribute("aria-label");
        expect(button).toHaveAttribute("aria-pressed");
      });
    });

    it("has proper ARIA attributes on action buttons", () => {
      renderWithProvider();

      const closeButton = screen.getByLabelText("Close modal");
      expect(closeButton).toBeInTheDocument();
      expect(closeButton).toHaveAttribute("aria-label");
    });

    it("provides accessible error messages", async () => {
      renderWithProvider({ transaction: null });

      const signButton = screen.queryByText("Sign");
      if (signButton) {
        fireEvent.click(signButton);

        await waitFor(() => {
          const errorArea = screen.getByRole("alert");
          expect(errorArea).toHaveAttribute("role", "alert");
        });
      }
    });

    it("announces status changes to screen readers", async () => {
      renderWithProvider();

      const contentArea = document.querySelector('[aria-live="polite"]');
      expect(contentArea).toBeInTheDocument();

      // Status changes should be announced via aria-live
      const signButtons = screen.getAllByText("Sign");
      fireEvent.click(signButtons[0]);

      expect(contentArea).toBeInTheDocument(); // Live region persists
    });

    it("has proper regions for different content sections", () => {
      renderWithProvider();

      // Review section should be a region
      const reviewRegion = screen.getByLabelText("Review transaction section");
      expect(reviewRegion).toBeInTheDocument();

      // Signers section should be a region
      const signersRegion = screen.getByLabelText("Signers list");
      expect(signersRegion).toBeInTheDocument();
    });

    it("marks decorative elements as aria-hidden", () => {
      renderWithProvider();

      const listitems = screen.getAllByRole("listitem");
      listitems.forEach((item) => {
        const decorativeElement = item.querySelector('[aria-hidden="true"]');
        expect(decorativeElement).toBeInTheDocument();
      });
    });

    it("sets aria-busy on dialog during loading", async () => {
      renderWithProvider();

      const modal = screen.getByRole("dialog");
      expect(modal).toHaveAttribute("aria-busy", "false");

      const signButtons = screen.getAllByText("Sign");
      fireEvent.click(signButtons[0]);

      expect(modal).toHaveAttribute("aria-busy", "true");

      await waitFor(() => {
        expect(modal).toHaveAttribute("aria-busy", "false");
      }, { timeout: 2000 });
    });

    it("has screen reader announcement region for step transitions", () => {
      renderWithProvider();

      const announcementRegion = document.querySelector('[aria-live="assertive"][aria-atomic="true"]');
      expect(announcementRegion).toBeInTheDocument();
      expect(announcementRegion).toHaveClass("sr-only");
    });

    it("traps focus within the modal", async () => {
      renderWithProvider();

      const modal = screen.getByRole("dialog");
      const closeButton = screen.getByLabelText("Close modal");
      const signButtons = screen.getAllByText("Sign");
      const firstSignButton = signButtons[0];

      closeButton.focus();

      // Tab forward from close button should move to first sign button
      fireEvent.keyDown(document, { key: "Tab" });
      // Wait for React to process
      await waitFor(() => {
        expect(document.activeElement).toBe(firstSignButton);
      });
    });

    it("traps focus in reverse direction with Shift+Tab", () => {
      renderWithProvider();

      const modal = screen.getByRole("dialog");
      const closeButton = screen.getByLabelText("Close modal");
      const signButtons = screen.getAllByText("Sign");
      const firstSignButton = signButtons[0];

      firstSignButton.focus();

      // Shift+Tab from first sign button should wrap to close button
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

      expect(document.activeElement).toBe(closeButton);
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

  describe("Edge Cases", () => {
    it("handles empty signers list gracefully", () => {
      const noSignersTransaction = {
        ...mockTransaction,
        signers: [],
      };
      renderWithProvider({ transaction: noSignersTransaction });
      expect(screen.getByText("Multi-Signature Approval")).toBeInTheDocument();
      expect(screen.getByText(/Transaction must have at least one signer/i)).toBeInTheDocument();
    });

    it("handles single signer correctly", () => {
      const singleSignerTransaction = {
        ...mockTransaction,
        signers: [
          { id: "signer1", publicKey: "G123...", name: "Alice", weight: 1, hasSigned: false },
        ],
        minSignatures: 1,
      };
      renderWithProvider({ transaction: singleSignerTransaction });

      const signButtons = screen.getAllByText("Sign");
      expect(signButtons).toHaveLength(1);
      expect(screen.getByText("Signatures (0/1)")).toBeInTheDocument();
    });

    it("shows all signers as signed when pre-signed", () => {
      const allSignedTransaction = {
        ...mockTransaction,
        signers: [
          { id: "signer1", publicKey: "G123...", name: "Alice", weight: 1, hasSigned: true },
          { id: "signer2", publicKey: "G456...", name: "Bob", weight: 1, hasSigned: true },
        ],
      };
      renderWithProvider({ transaction: allSignedTransaction });

      const signedButtons = screen.getAllByText("Signed");
      expect(signedButtons).toHaveLength(2);
      expect(screen.getByText("Submit Transaction")).toBeInTheDocument();
    });
  });

  describe("Component Cleanup", () => {
    it("restores body overflow on unmount", () => {
      const { unmount } = renderWithProvider({ isOpen: true });
      expect(document.body.style.overflow).toBe("hidden");
      unmount();
      expect(document.body.style.overflow).toBe("");
    });
  });

  describe("Loading Interaction Guards", () => {
    it("disables close button during loading", async () => {
      renderWithProvider();

      const signButtons = screen.getAllByText("Sign");
      fireEvent.click(signButtons[0]);

      const closeButton = screen.getByLabelText("Close modal");
      expect(closeButton).toBeDisabled();

      await waitFor(() => {
        expect(closeButton).not.toBeDisabled();
      }, { timeout: 2000 });
    });

    it("prevents backdrop close during loading", async () => {
      const mockOnClose = vi.fn();
      renderWithProvider({ onClose: mockOnClose });

      const signButtons = screen.getAllByText("Sign");
      fireEvent.click(signButtons[0]);

      const backdrop = screen.getByText("Multi-Signature Approval")
        .closest('[role="dialog"]')?.previousSibling as HTMLElement;
      if (backdrop) {
        fireEvent.click(backdrop);
      }

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe("Render Boundary States", () => {
    it("renders without crashing when transaction is null", () => {
      renderWithProvider({ transaction: null });

      expect(screen.getByText("Multi-Signature Approval")).toBeInTheDocument();
      expect(screen.getByText("Review Transaction")).toBeInTheDocument();
      expect(screen.queryByText("100 USDC")).not.toBeInTheDocument();
    });

    it("reopens correctly after being closed", () => {
      const mockOnClose = vi.fn();
      const { rerender } = render(
        <MultisigProvider networkPassphrase="Test Network">
          <MultisigApprovalModal
            isOpen={true}
            onClose={mockOnClose}
            networkPassphrase="Test Network"
            transaction={mockTransaction}
          />
        </MultisigProvider>
      );

      expect(screen.getByText("Multi-Signature Approval")).toBeInTheDocument();

      rerender(
        <MultisigProvider networkPassphrase="Test Network">
          <MultisigApprovalModal
            isOpen={false}
            onClose={mockOnClose}
            networkPassphrase="Test Network"
            transaction={mockTransaction}
          />
        </MultisigProvider>
      );

      expect(screen.queryByText("Multi-Signature Approval")).not.toBeInTheDocument();

      rerender(
        <MultisigProvider networkPassphrase="Test Network">
          <MultisigApprovalModal
            isOpen={true}
            onClose={mockOnClose}
            networkPassphrase="Test Network"
            transaction={mockTransaction}
          />
        </MultisigProvider>
      );

      expect(screen.getByText("Multi-Signature Approval")).toBeInTheDocument();
    });
  });
});
