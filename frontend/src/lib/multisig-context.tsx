"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from "react";

export type MultisigApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "processing";
export type MultisigStep = "review" | "sign" | "submit" | "processing" | "confirm" | "error";

export interface MultisigSigner {
  id: string;
  publicKey: string;
  name?: string;
  weight: number;
  hasSigned: boolean;
  signature?: string;
  signedAt?: string;
}

export interface MultisigTransaction {
  id: string;
  sourceAccount: string;
  destination: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  memo?: string;
  minSignatures: number;
  signers: MultisigSigner[];
  xdr?: string;
  submittedTxHash?: string;
  createdAt: string;
  expiresAt?: string;
  status: MultisigApprovalStatus;
}

export interface MultisigContextType {
  // State
  transaction: MultisigTransaction | null;
  currentStep: MultisigStep;
  isLoading: boolean;
  isPendingConfirmation: boolean;
  error: string | null;
  isMounted: boolean;
  isVisible: boolean;

  // Actions
  setTransaction: (transaction: MultisigTransaction | null) => void;
  setCurrentStep: (step: MultisigStep) => void;
  signTransaction: (signerId: string) => Promise<void>;
  submitTransaction: () => Promise<void>;
  resetModal: () => void;
  clearError: () => void;
  retryAction: () => void;

  // Computed values
  canSign: boolean;
  canSubmit: boolean;
  signedCount: number;
  requiredSignatures: number;
  progress: number;
  isExpired: boolean;
  timeRemaining: string | null;
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

type MultisigState = {
  transaction: MultisigTransaction | null;
  currentStep: MultisigStep;
  isLoading: boolean;
  isPendingConfirmation: boolean;
  error: string | null;
  isMounted: boolean;
  isVisible: boolean;
};

type MultisigAction =
  | { type: "SET_TRANSACTION"; payload: MultisigTransaction | null }
  | { type: "SET_STEP"; payload: MultisigStep }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_PENDING_CONFIRMATION"; payload: boolean }
  | { type: "SET_ERROR"; payload: string }
  | { type: "CLEAR_ERROR" }
  | { type: "RESET" }
  | { type: "SET_VISIBLE"; payload: boolean }
  | { type: "OPTIMISTIC_SIGN"; signerId: string }
  | { type: "CONFIRM_SIGN"; signerId: string; signature: string; signedAt: string }
  | { type: "REVERT_SIGN"; previousTransaction: MultisigTransaction }
  | { type: "SUBMIT_SUCCESS"; txHash: string };

const INITIAL_STATE: MultisigState = {
  transaction: null,
  currentStep: "review",
  isLoading: false,
  isPendingConfirmation: false,
  error: null,
  isMounted: false,
  isVisible: false,
};

function multisigReducer(state: MultisigState, action: MultisigAction): MultisigState {
  switch (action.type) {
    case "SET_TRANSACTION":
      return { ...state, transaction: action.payload, error: null };
    case "SET_STEP":
      return { ...state, currentStep: action.payload };
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };
    case "SET_PENDING_CONFIRMATION":
      return { ...state, isPendingConfirmation: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload, isLoading: false };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    case "RESET":
      return INITIAL_STATE;
    case "SET_VISIBLE":
      return { ...state, isVisible: action.payload };
    case "OPTIMISTIC_SIGN": {
      if (!state.transaction) return state;
      return {
        ...state,
        transaction: {
          ...state.transaction,
          signers: state.transaction.signers.map((s) =>
            s.id === action.signerId ? { ...s, hasSigned: true } : s,
          ),
        },
      };
    }
    case "CONFIRM_SIGN": {
      if (!state.transaction) return state;
      const updatedSigners = state.transaction.signers.map((s) =>
        s.id === action.signerId
          ? { ...s, hasSigned: true, signature: action.signature, signedAt: action.signedAt }
          : s,
      );
      const signedWeight = updatedSigners
        .filter((s) => s.hasSigned)
        .reduce((sum, s) => sum + s.weight, 0);
      const nextStep: MultisigStep =
        signedWeight >= state.transaction.minSignatures ? "submit" : state.currentStep;
      return {
        ...state,
        transaction: { ...state.transaction, signers: updatedSigners },
        currentStep: nextStep,
        isLoading: false,
      };
    }
    case "REVERT_SIGN":
      return { ...state, transaction: action.previousTransaction, isLoading: false };
    case "SUBMIT_SUCCESS":
      return {
        ...state,
        transaction: state.transaction
          ? { ...state.transaction, status: "approved", submittedTxHash: action.txHash }
          : state.transaction,
        currentStep: "confirm",
        isLoading: false,
      };
    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

const MultisigContext = createContext<MultisigContextType | undefined>(undefined);

interface MultisigProviderProps {
  readonly children: ReactNode;
  readonly networkPassphrase: string;
}

export function MultisigProvider({ children, networkPassphrase }: MultisigProviderProps) {
  const [state, dispatch] = useReducer(multisigReducer, INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  const clearError = useCallback(() => {
    dispatch({ type: "CLEAR_ERROR" });
  }, []);

  const setCurrentStep = useCallback((step: MultisigStep) => {
    dispatch({ type: "SET_STEP", payload: step });
  }, []);

  const resetModal = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  const setTransactionSafe = useCallback((newTransaction: MultisigTransaction | null) => {
    try {
      if (newTransaction) {
        if (!newTransaction.id || !newTransaction.sourceAccount || !newTransaction.destination) {
          throw new Error("Invalid transaction structure");
        }
        if (!Array.isArray(newTransaction.signers) || newTransaction.signers.length === 0) {
          throw new Error("Transaction must have at least one signer");
        }
        const totalWeight = newTransaction.signers.reduce((sum, s) => sum + s.weight, 0);
        if (newTransaction.minSignatures > totalWeight) {
          throw new Error("Required signatures exceed total signer weight");
        }
      }
      dispatch({ type: "SET_TRANSACTION", payload: newTransaction });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Invalid transaction";
      dispatch({ type: "SET_ERROR", payload: errorMessage });
      console.error("Transaction validation error:", err);
    }
  }, []);

  const signTransaction = useCallback(async (signerId: string) => {
    const { transaction } = stateRef.current;
    if (!transaction) {
      dispatch({ type: "SET_ERROR", payload: "No transaction to sign" });
      return;
    }

    const signer = transaction.signers.find((s) => s.id === signerId);
    if (!signer) {
      dispatch({ type: "SET_ERROR", payload: "Signer not found" });
      return;
    }
    if (signer.hasSigned) {
      dispatch({ type: "SET_ERROR", payload: "Signer has already signed" });
      return;
    }

    const previousTransaction = { ...transaction, signers: [...transaction.signers] };

    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "CLEAR_ERROR" });
    dispatch({ type: "OPTIMISTIC_SIGN", signerId });

    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const signature = `mock_signature_${Date.now()}_${signerId}`;
      const signedAt = new Date().toISOString();
      dispatch({ type: "CONFIRM_SIGN", signerId, signature, signedAt });
    } catch (err) {
      dispatch({ type: "REVERT_SIGN", previousTransaction });
      const errorMessage = err instanceof Error ? err.message : "Failed to sign transaction";
      dispatch({ type: "SET_ERROR", payload: errorMessage });
      console.error("Signing error:", err);
    }
  }, []);

  const submitTransaction = useCallback(async () => {
    const { transaction } = stateRef.current;
    if (!transaction) {
      dispatch({ type: "SET_ERROR", payload: "No transaction to submit" });
      return;
    }

    const previousTransaction = { ...transaction, signers: [...transaction.signers] };

    try {
      clearError();

      const signedWeight = transaction.signers.filter(s => s.hasSigned)
        .reduce((sum, s) => sum + s.weight, 0);
      
      if (signedWeight < transaction.minSignatures) {
        throw new Error("Not enough signatures to submit transaction");
      }

      // Optimistic update: immediately transition to confirm step with pending tx hash
      const pendingTxHash = `tx_pending_${Date.now()}`;
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_PENDING_CONFIRMATION", payload: true });
      dispatch({ type: "SET_STEP", payload: "confirm" });
      setTransactionSafe({
        ...transaction,
        status: "approved" as MultisigApprovalStatus,
        submittedTxHash: pendingTxHash,
      });

      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Finalize with real transaction hash
      const realTxHash = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      setTransactionSafe({
        ...transaction,
        status: 'approved' as MultisigApprovalStatus,
        submittedTxHash: realTxHash,
      });
      dispatch({ type: "SUBMIT_SUCCESS", txHash: realTxHash });
    } catch (err) {
      setTransactionSafe(previousTransaction);
      const errorMessage = err instanceof Error ? err.message : "Failed to submit transaction";
      dispatch({ type: "SET_ERROR", payload: errorMessage });
      dispatch({ type: "SET_STEP", payload: "error" });
      console.error("Submission error:", err);
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
      dispatch({ type: "SET_PENDING_CONFIRMATION", payload: false });
    }
  }, [clearError, setTransactionSafe]);

  const retryAction = useCallback(() => {
    dispatch({ type: "CLEAR_ERROR" });
    if (stateRef.current.currentStep === "error") {
      dispatch({ type: "SET_STEP", payload: "review" });
    }
  }, []);

  const { transaction, currentStep, isLoading, isPendingConfirmation, error, isMounted, isVisible } = state;

  const computedValues = useMemo(() => {
    if (!transaction) {
      return {
        canSign: false,
        canSubmit: false,
        signedCount: 0,
        requiredSignatures: 0,
        progress: 0,
        isExpired: false,
        timeRemaining: null,
      };
    }

    const signedWeight = transaction.signers
      .filter((s) => s.hasSigned)
      .reduce((sum, s) => sum + s.weight, 0);
    const minSignatures = transaction.minSignatures || 1;
    const progress = minSignatures > 0 ? (signedWeight / minSignatures) * 100 : 0;

    let isExpired = false;
    let timeRemaining: string | null = null;
    if (transaction.expiresAt) {
      const now = new Date();
      const expiry = new Date(transaction.expiresAt);
      isExpired = now >= expiry;
      if (!isExpired) {
        const diff = expiry.getTime() - now.getTime();
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        timeRemaining = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
      }
    }

    return {
      canSign: !isExpired && currentStep === "review",
      canSubmit: !isExpired && signedWeight >= transaction.minSignatures && currentStep !== "confirm",
      signedCount: transaction.signers.filter((s) => s.hasSigned).length,
      requiredSignatures: transaction.minSignatures,
      progress: Math.min(Math.max(progress, 0), 100),
      isExpired,
      timeRemaining,
    };
  }, [transaction, currentStep]);

  const value: MultisigContextType = useMemo(() => ({
    transaction,
    currentStep,
    isLoading,
    isPendingConfirmation,
    error,
    isMounted,
    isVisible,
    setTransaction: setTransactionSafe,
    setCurrentStep,
    signTransaction,
    submitTransaction,
    resetModal,
    clearError,
    retryAction,
    ...computedValues
  }), [
    transaction,
    currentStep,
    isLoading,
    isPendingConfirmation,
    error,
    isMounted,
    isVisible,
    setTransactionSafe,
    setCurrentStep,
    signTransaction,
    submitTransaction,
    resetModal,
    clearError,
    retryAction,
    computedValues
  ]);

  return (
    <MultisigContext.Provider value={value}>
      {children}
    </MultisigContext.Provider>
  );
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useMultisig() {
  const context = useContext(MultisigContext);
  if (context === undefined) {
    throw new Error("useMultisig must be used within a MultisigProvider");
  }
  return context;
}

export function useMultisigState() {
  const { 
    transaction, 
    currentStep, 
    isLoading, 
    isPendingConfirmation,
    error, 
    isMounted, 
    isVisible,
    canSign,
    canSubmit,
    signedCount,
    requiredSignatures,
    progress,
    isExpired,
    timeRemaining,
  } = useMultisig();

  return {
    transaction,
    currentStep,
    isLoading,
    isPendingConfirmation,
    error,
    isMounted,
    isVisible,
    canSign,
    canSubmit,
    signedCount,
    requiredSignatures,
    progress,
    isExpired,
    timeRemaining,
  };
}

export function useMultisigActions() {
  const {
    setTransaction,
    setCurrentStep,
    signTransaction,
    submitTransaction,
    resetModal,
    clearError,
    retryAction,
  } = useMultisig();

  return {
    setTransaction,
    setCurrentStep,
    signTransaction,
    submitTransaction,
    resetModal,
    clearError,
    retryAction,
  };
}
