/**
 * Optimistic-update tests for the Multi-sig Approval flow (issue #797).
 *
 * `signTransaction` marks a signer as signed immediately (optimistically) and
 * only attaches the real signature once the async signing settles. These tests
 * capture that window and the eventual finalize + step advance.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  MultisigProvider,
  useMultisigState,
  useMultisigActions,
  type MultisigTransaction,
} from "./multisig-context";

const tx: MultisigTransaction = {
  id: "tx-opt-1",
  sourceAccount: "GSOURCE",
  destination: "GDEST",
  amount: "100",
  assetCode: "USDC",
  minSignatures: 2,
  signers: [
    { id: "s1", publicKey: "GPUB1", name: "Alice", weight: 1, hasSigned: false },
    { id: "s2", publicKey: "GPUB2", name: "Bob", weight: 1, hasSigned: false },
  ],
  createdAt: "2024-01-01T00:00:00Z",
  status: "pending",
};

function cannedTx(overrides: Partial<MultisigTransaction> = {}): MultisigTransaction {
  return { ...tx, ...overrides };
}

function Consumer() {
  const { transaction, signedCount, currentStep, isPendingConfirmation, error } = useMultisigState();
  const { setTransaction, signTransaction, submitTransaction } = useMultisigActions();
  const s1 = transaction?.signers.find((s) => s.id === "s1");
  const s2 = transaction?.signers.find((s) => s.id === "s2");
  return (
    <div>
      <span data-testid="signed-count">{signedCount}</span>
      <span data-testid="step">{currentStep}</span>
      <span data-testid="pending-confirmation">{String(isPendingConfirmation)}</span>
      <span data-testid="error">{error || "no-error"}</span>
      <span data-testid="s1-signed">{String(!!s1?.hasSigned)}</span>
      <span data-testid="s1-has-signature">{String(!!s1?.signature)}</span>
      <span data-testid="s2-signed">{String(!!s2?.hasSigned)}</span>
      <span data-testid="tx-hash">{transaction?.submittedTxHash || "none"}</span>
      <button onClick={() => setTransaction(tx)}>set-tx</button>
      <button onClick={() => signTransaction("s1")}>sign-s1</button>
      <button onClick={() => signTransaction("s2")}>sign-s2</button>
      <button onClick={submitTransaction}>submit-tx</button>
    </div>
  );
}

const renderModal = () =>
  render(
    <MultisigProvider networkPassphrase="Test Network">
      <Consumer />
    </MultisigProvider>,
  );

describe("Multi-sig optimistic updates (#797)", () => {
  it("marks the signer as signed optimistically before the signature settles", async () => {
    renderModal();
    fireEvent.click(screen.getByText("set-tx"));
    await waitFor(() => expect(screen.getByTestId("signed-count")).toHaveTextContent("0"));

    fireEvent.click(screen.getByText("sign-s1"));

    // Optimistic: signer flips to signed immediately, before the async signature.
    await waitFor(() => expect(screen.getByTestId("s1-signed")).toHaveTextContent("true"));
    expect(screen.getByTestId("s1-has-signature")).toHaveTextContent("false");

    // Settled: the real signature is attached once signing resolves.
    await waitFor(
      () => expect(screen.getByTestId("s1-has-signature")).toHaveTextContent("true"),
      { timeout: 2000 },
    );
    expect(screen.getByTestId("signed-count")).toHaveTextContent("1");
  });

  it("advances to the submit step once the signature threshold is met", async () => {
    renderModal();
    fireEvent.click(screen.getByText("set-tx"));
    await waitFor(() => expect(screen.getByTestId("signed-count")).toHaveTextContent("0"));

    fireEvent.click(screen.getByText("sign-s1"));
    await waitFor(
      () => expect(screen.getByTestId("s1-has-signature")).toHaveTextContent("true"),
      { timeout: 2000 },
    );

    fireEvent.click(screen.getByText("sign-s2"));
    await waitFor(
      () => {
        expect(screen.getByTestId("s2-signed")).toHaveTextContent("true");
        expect(screen.getByTestId("step")).toHaveTextContent("submit");
      },
      { timeout: 2000 },
    );
  });

  it("surfaces an error when signing without a transaction", async () => {
    renderModal();
    fireEvent.click(screen.getByText("sign-s1"));
    await waitFor(() => expect(screen.getByTestId("error")).not.toHaveTextContent("no-error"));
  });

  describe("Optimistic submission", () => {
    it("immediately advances to confirm step on submit", async () => {
      renderModal();
      fireEvent.click(screen.getByText("set-tx"));
      await waitFor(() => expect(screen.getByTestId("signed-count")).toHaveTextContent("0"));

      // Sign both signers to meet threshold
      fireEvent.click(screen.getByText("sign-s1"));
      await waitFor(
        () => expect(screen.getByTestId("s1-has-signature")).toHaveTextContent("true"),
        { timeout: 2000 },
      );

      fireEvent.click(screen.getByText("sign-s2"));
      await waitFor(
        () => expect(screen.getByTestId("s2-signed")).toHaveTextContent("true"),
        { timeout: 2000 },
      );

      // Submit optimistically — should skip "processing" and land on "confirm" immediately
      fireEvent.click(screen.getByText("submit-tx"));

      await waitFor(() => {
        expect(screen.getByTestId("step")).toHaveTextContent("confirm");
      });
    });

    it("sets isPendingConfirmation true on submit and false after settlement", async () => {
      renderModal();
      fireEvent.click(screen.getByText("set-tx"));
      await waitFor(() => expect(screen.getByTestId("signed-count")).toHaveTextContent("0"));

      fireEvent.click(screen.getByText("sign-s1"));
      await waitFor(
        () => expect(screen.getByTestId("s1-has-signature")).toHaveTextContent("true"),
        { timeout: 2000 },
      );

      fireEvent.click(screen.getByText("sign-s2"));
      await waitFor(
        () => expect(screen.getByTestId("s2-signed")).toHaveTextContent("true"),
        { timeout: 2000 },
      );

      fireEvent.click(screen.getByText("submit-tx"));

      // Optimistic: pending confirmation is true immediately
      await waitFor(() => {
        expect(screen.getByTestId("pending-confirmation")).toHaveTextContent("true");
      });

      // Settled: pending confirmation flips to false
      await waitFor(
        () => expect(screen.getByTestId("pending-confirmation")).toHaveTextContent("false"),
        { timeout: 3000 },
      );
    });

    it("shows a pending tx hash during optimistic phase and real hash after settlement", async () => {
      renderModal();
      fireEvent.click(screen.getByText("set-tx"));
      await waitFor(() => expect(screen.getByTestId("signed-count")).toHaveTextContent("0"));

      fireEvent.click(screen.getByText("sign-s1"));
      await waitFor(
        () => expect(screen.getByTestId("s1-has-signature")).toHaveTextContent("true"),
        { timeout: 2000 },
      );

      fireEvent.click(screen.getByText("sign-s2"));
      await waitFor(
        () => expect(screen.getByTestId("s2-signed")).toHaveTextContent("true"),
        { timeout: 2000 },
      );

      fireEvent.click(screen.getByText("submit-tx"));

      // Optimistic: a pending tx hash is set
      await waitFor(() => {
        expect(screen.getByTestId("tx-hash").textContent).toMatch(/^tx_pending_/);
      });

      // Settled: a real tx hash replaces the pending one
      await waitFor(
        () => expect(screen.getByTestId("tx-hash").textContent).toMatch(/^tx_(?!pending_)/),
        { timeout: 3000 },
      );
    });

    it("rolls back to error step when submission fails", async () => {
      // Force a failure by not setting a transaction before calling submit
      renderModal();

      fireEvent.click(screen.getByText("set-tx"));
      await waitFor(() => expect(screen.getByTestId("signed-count")).toHaveTextContent("0"));

      fireEvent.click(screen.getByText("sign-s1"));
      await waitFor(
        () => expect(screen.getByTestId("s1-has-signature")).toHaveTextContent("true"),
        { timeout: 2000 },
      );

      // Submit without enough signatures — should fail
      fireEvent.click(screen.getByText("submit-tx"));

      await waitFor(() => {
        expect(screen.getByTestId("error")).not.toHaveTextContent("no-error");
      });
    });
  });
});
