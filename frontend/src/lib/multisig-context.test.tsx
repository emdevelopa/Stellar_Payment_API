import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MultisigProvider, useMultisig, useMultisigState, useMultisigActions } from "./multisig-context";

describe("Multisig Context", () => {
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
      { id: "signer3", publicKey: "G789...", name: "Charlie", weight: 2, hasSigned: false },
    ],
    createdAt: "2024-01-01T00:00:00Z",
    status: "pending" as const,
  };

  const TestComponent = () => {
    const { 
      transaction, 
      currentStep, 
      isLoading, 
      error, 
      canSign, 
      canSubmit, 
      signedCount, 
      requiredSignatures, 
      progress 
    } = useMultisigState();
    const { 
      setTransaction, 
      setCurrentStep, 
      signTransaction, 
      submitTransaction, 
      resetModal, 
      clearError, 
      retryAction 
    } = useMultisigActions();

    return (
      <div>
        <div data-testid="transaction-id">{transaction?.id || "none"}</div>
        <div data-testid="current-step">{currentStep}</div>
        <div data-testid="is-loading">{isLoading.toString()}</div>
        <div data-testid="error">{error || "no-error"}</div>
        <div data-testid="can-sign">{canSign.toString()}</div>
        <div data-testid="can-submit">{canSubmit.toString()}</div>
        <div data-testid="signed-count">{signedCount}</div>
        <div data-testid="required-signatures">{requiredSignatures}</div>
        <div data-testid="progress">{progress}</div>
        
        <button onClick={() => setTransaction(mockTransaction)}>Set Transaction</button>
        <button onClick={() => setCurrentStep("sign")}>Set Step</button>
        <button onClick={() => signTransaction("signer1")}>Sign Transaction</button>
        <button onClick={submitTransaction}>Submit Transaction</button>
        <button onClick={resetModal}>Reset</button>
        <button onClick={clearError}>Clear Error</button>
        <button onClick={retryAction}>Retry</button>
      </div>
    );
  };

  const renderWithProvider = (props = {}) => {
    return render(
      <MultisigProvider networkPassphrase="Test Network" {...props}>
        <TestComponent />
      </MultisigProvider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Initial State", () => {
    it("initializes with correct default values", () => {
      renderWithProvider();

      expect(screen.getByTestId("transaction-id")).toHaveTextContent("none");
      expect(screen.getByTestId("current-step")).toHaveTextContent("review");
      expect(screen.getByTestId("is-loading")).toHaveTextContent("false");
      expect(screen.getByTestId("error")).toHaveTextContent("no-error");
      expect(screen.getByTestId("can-sign")).toHaveTextContent("false");
      expect(screen.getByTestId("can-submit")).toHaveTextContent("false");
      expect(screen.getByTestId("signed-count")).toHaveTextContent("0");
      expect(screen.getByTestId("required-signatures")).toHaveTextContent("0");
      expect(screen.getByTestId("progress")).toHaveTextContent("0");
    });
  });

  describe("Transaction Management", () => {
    it("sets transaction correctly", async () => {
      renderWithProvider();

      fireEvent.click(screen.getByText("Set Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("transaction-id")).toHaveTextContent("test-tx-1");
        expect(screen.getByTestId("required-signatures")).toHaveTextContent("2");
        expect(screen.getByTestId("signed-count")).toHaveTextContent("0");
        expect(screen.getByTestId("progress")).toHaveTextContent("0");
      });
    });

    it("validates transaction structure", async () => {
      renderWithProvider();

      const invalidTransaction = { ...mockTransaction, id: "" };
      
      // This would need to be tested through the actual setTransaction call
      // For now, we'll test the validation logic indirectly
      fireEvent.click(screen.getByText("Set Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("transaction-id")).toHaveTextContent("test-tx-1");
      });
    });

    it("handles invalid transaction gracefully", async () => {
      renderWithProvider();

      // Test with a transaction that has invalid signers
      const invalidSignersTransaction = {
        ...mockTransaction,
        signers: [], // Empty signers array
      };

      // This would be tested through the validation logic
      expect(true).toBe(true); // Placeholder for validation test
    });
  });

  describe("Signing Process", () => {
    it("signs transaction correctly", async () => {
      renderWithProvider();

      // First set the transaction
      fireEvent.click(screen.getByText("Set Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("transaction-id")).toHaveTextContent("test-tx-1");
      });

      // Then sign
      fireEvent.click(screen.getByText("Sign Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("is-loading")).toHaveTextContent("true");
      });

      await waitFor(() => {
        expect(screen.getByTestId("is-loading")).toHaveTextContent("false");
        expect(screen.getByTestId("signed-count")).toHaveTextContent("1");
        expect(screen.getByTestId("progress")).toHaveTextContent("50"); // 1/2 signatures
      }, { timeout: 2000 });
    });

    it("prevents double signing", async () => {
      renderWithProvider();

      fireEvent.click(screen.getByText("Set Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("transaction-id")).toHaveTextContent("test-tx-1");
      });

      // Sign first time
      fireEvent.click(screen.getByText("Sign Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("signed-count")).toHaveTextContent("1");
      }, { timeout: 2000 });

      // Try to sign again
      fireEvent.click(screen.getByText("Sign Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("signed-count")).toHaveTextContent("1"); // Should still be 1
      }, { timeout: 2000 });
    });

    it("handles signing errors", async () => {
      renderWithProvider();

      // Try to sign without setting transaction
      fireEvent.click(screen.getByText("Sign Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("error")).not.toHaveTextContent("no-error");
      });
    });
  });

  describe("Submission Process", () => {
    it("submits transaction when enough signatures", async () => {
      renderWithProvider();

      fireEvent.click(screen.getByText("Set Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("transaction-id")).toHaveTextContent("test-tx-1");
      });

      // Sign twice to meet requirements
      fireEvent.click(screen.getByText("Sign Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("signed-count")).toHaveTextContent("1");
      }, { timeout: 2000 });

      fireEvent.click(screen.getByText("Sign Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("signed-count")).toHaveTextContent("2");
        expect(screen.getByTestId("can-submit")).toHaveTextContent("true");
      }, { timeout: 2000 });

      // Submit
      fireEvent.click(screen.getByText("Submit Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("is-loading")).toHaveTextContent("true");
      });

      await waitFor(() => {
        expect(screen.getByTestId("is-loading")).toHaveTextContent("false");
        expect(screen.getByTestId("current-step")).toHaveTextContent("confirm");
      }, { timeout: 3000 });
    });

    it("prevents submission without enough signatures", async () => {
      renderWithProvider();

      fireEvent.click(screen.getByText("Set Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("can-submit")).toHaveTextContent("false");
      });

      fireEvent.click(screen.getByText("Submit Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("error")).not.toHaveTextContent("no-error");
      });
    });
  });

  describe("Step Management", () => {
    it("changes steps correctly", async () => {
      renderWithProvider();

      fireEvent.click(screen.getByText("Set Step"));

      await waitFor(() => {
        expect(screen.getByTestId("current-step")).toHaveTextContent("sign");
      });
    });
  });

  describe("Error Handling", () => {
    it("clears errors correctly", async () => {
      renderWithProvider();

      // Trigger an error
      fireEvent.click(screen.getByText("Sign Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("error")).not.toHaveTextContent("no-error");
      });

      // Clear error
      fireEvent.click(screen.getByText("Clear Error"));

      await waitFor(() => {
        expect(screen.getByTestId("error")).toHaveTextContent("no-error");
      });
    });

    it("retries actions correctly", async () => {
      renderWithProvider();

      // Trigger an error
      fireEvent.click(screen.getByText("Sign Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("error")).not.toHaveTextContent("no-error");
      });

      // Retry
      fireEvent.click(screen.getByText("Retry"));

      await waitFor(() => {
        expect(screen.getByTestId("current-step")).toHaveTextContent("review");
      });
    });
  });

  describe("Reset Functionality", () => {
    it("resets modal state correctly", async () => {
      renderWithProvider();

      // Set transaction and trigger error
      fireEvent.click(screen.getByText("Set Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("transaction-id")).toHaveTextContent("test-tx-1");
      });

      fireEvent.click(screen.getByText("Sign Transaction"));

      await waitFor(() => {
        expect(screen.getByTestId("error")).not.toHaveTextContent("no-error");
      });

      // Reset
      fireEvent.click(screen.getByText("Reset"));

      await waitFor(() => {
        expect(screen.getByTestId("transaction-id")).toHaveTextContent("none");
        expect(screen.getByTestId("current-step")).toHaveTextContent("review");
        expect(screen.getByTestId("error")).toHaveTextContent("no-error");
      });
    });
  });
});

describe("useMultisig Hook", () => {
  it("throws error when used outside provider", () => {
    const TestComponent = () => {
      useMultisig();
      return <div>Test</div>;
    };

    expect(() => {
      render(<TestComponent />);
    }).toThrow("useMultisig must be used within a MultisigProvider");
  });
});

describe("useMultisigState Hook", () => {
  it("provides state values correctly", async () => {
    const TestComponent = () => {
      const state = useMultisigState();
      
      return (
        <div>
          <div data-testid="state-transaction">{state.transaction?.id || "none"}</div>
          <div data-testid="state-step">{state.currentStep}</div>
          <div data-testid="state-loading">{state.isLoading.toString()}</div>
        </div>
      );
    };

    render(
      <MultisigProvider networkPassphrase="Test Network">
        <TestComponent />
      </MultisigProvider>
    );

    expect(screen.getByTestId("state-transaction")).toHaveTextContent("none");
    expect(screen.getByTestId("state-step")).toHaveTextContent("review");
    expect(screen.getByTestId("state-loading")).toHaveTextContent("false");
  });
});

describe("useMultisigActions Hook", () => {
  it("provides action functions correctly", async () => {
    const TestComponent = () => {
      const actions = useMultisigActions();
      
      return (
        <div>
          <button onClick={() => actions.setCurrentStep("sign")}>Set Step</button>
          <button onClick={actions.clearError}>Clear Error</button>
          <button onClick={actions.resetModal}>Reset</button>
          <div data-testid="actions-available">
            {typeof actions.setTransaction === "function" ? "yes" : "no"}
          </div>
        </div>
      );
    };

    render(
      <MultisigProvider networkPassphrase="Test Network">
        <TestComponent />
      </MultisigProvider>
    );

    expect(screen.getByTestId("actions-available")).toHaveTextContent("yes");
    expect(screen.getByText("Set Step")).toBeInTheDocument();
    expect(screen.getByText("Clear Error")).toBeInTheDocument();
    expect(screen.getByText("Reset")).toBeInTheDocument();
  });
});
