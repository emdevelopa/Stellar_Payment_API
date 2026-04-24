"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from "react";

export type MultisigApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "processing";
export type MultisigStep = "review" | "sign" | "submit" | "confirm" | "error";

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

const MultisigContext = createContext<MultisigContextType | undefined>(undefined);

interface MultisigProviderProps {
  readonly children: ReactNode;
  readonly networkPassphrase: string;
}

export function MultisigProvider({ children, networkPassphrase }: MultisigProviderProps) {
  const [transaction, setTransaction] = useState<MultisigTransaction | null>(null);
  const [currentStep, setCurrentStep] = useState<MultisigStep>("review");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const resetModal = useCallback(() => {
    setTransaction(null);
    setCurrentStep("review");
    setIsLoading(false);
    setError(null);
    setIsVisible(false);
  }, []);

  const setTransactionSafe = useCallback((newTransaction: MultisigTransaction | null) => {
    try {
      if (newTransaction) {
        // Validate transaction structure
        if (!newTransaction.id || !newTransaction.sourceAccount || !newTransaction.destination) {
          throw new Error("Invalid transaction structure");
        }
        
        // Validate signers
        if (!Array.isArray(newTransaction.signers) || newTransaction.signers.length === 0) {
          throw new Error("Transaction must have at least one signer");
        }
        
        // Validate signature requirements
        const totalWeight = newTransaction.signers.reduce((sum, signer) => sum + signer.weight, 0);
        if (newTransaction.minSignatures > totalWeight) {
          throw new Error("Required signatures exceed total signer weight");
        }
      }
      
      setTransaction(newTransaction);
      clearError();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Invalid transaction";
      setError(errorMessage);
      console.error("Transaction validation error:", err);
    }
  }, [clearError]);

  const signTransaction = useCallback(async (signerId: string) => {
    if (!transaction) {
      setError("No transaction to sign");
      return;
    }

    const previousTransaction = { ...transaction, signers: [...transaction.signers] };

    try {
      setIsLoading(true);
      clearError();

      // Find the signer
      const signer = transaction.signers.find(s => s.id === signerId);
      if (!signer) {
        throw new Error("Signer not found");
      }

      if (signer.hasSigned) {
        throw new Error("Signer has already signed");
      }

      // Optimistic update
      const optimisticSigners = transaction.signers.map(s => 
        s.id === signerId ? { ...s, hasSigned: true } : s
      );
      setTransactionSafe({ ...transaction, signers: optimisticSigners });

      // Simulate signing process (in real implementation, this would interact with wallet)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Update signer with signature
      const mockSignature = `mock_signature_${Date.now()}_${signerId}`;
      const updatedSigners = transaction.signers.map(s => 
        s.id === signerId 
          ? { ...s, hasSigned: true, signature: mockSignature, signedAt: new Date().toISOString() }
          : s
      );

      const updatedTransaction = {
        ...transaction,
        signers: updatedSigners,
        status: 'pending' as MultisigApprovalStatus
      };

      setTransactionSafe(updatedTransaction);
      
      // Auto-advance to submit step if enough signatures
      const signedWeight = updatedSigners.filter(s => s.hasSigned)
        .reduce((sum, s) => sum + s.weight, 0);
      
      if (signedWeight >= transaction.minSignatures) {
        setCurrentStep("submit");
      }

    } catch (err) {
      // Revert optimistic update
      setTransactionSafe(previousTransaction);
      const errorMessage = err instanceof Error ? err.message : "Failed to sign transaction";
      setError(errorMessage);
      console.error("Signing error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [transaction, clearError, setTransactionSafe]);

  const submitTransaction = useCallback(async () => {
    if (!transaction) {
      setError("No transaction to submit");
      return;
    }

    try {
      setIsLoading(true);
      clearError();
      setCurrentStep("processing");

      // Verify enough signatures
      const signedWeight = transaction.signers.filter(s => s.hasSigned)
        .reduce((sum, s) => sum + s.weight, 0);
      
      if (signedWeight < transaction.minSignatures) {
        throw new Error("Not enough signatures to submit transaction");
      }

      // Simulate submission process
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Update transaction with submitted hash
      const mockTxHash = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const updatedTransaction = {
        ...transaction,
        status: 'approved' as MultisigApprovalStatus,
        submittedTxHash: mockTxHash
      };

      setTransactionSafe(updatedTransaction);
      setCurrentStep("confirm");

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to submit transaction";
      setError(errorMessage);
      setCurrentStep("error");
      console.error("Submission error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [transaction, clearError, setTransactionSafe]);

  const retryAction = useCallback(() => {
    clearError();
    if (currentStep === "error") {
      setCurrentStep("review");
    }
  }, [currentStep, clearError]);

  // Computed values
  const computedValues = useMemo(() => {
    if (!transaction) {
      return {
        canSign: false,
        canSubmit: false,
        signedCount: 0,
        requiredSignatures: 0,
        progress: 0,
        isExpired: false,
        timeRemaining: null
      };
    }

    const signedWeight = transaction.signers.filter(s => s.hasSigned)
      .reduce((sum, s) => sum + s.weight, 0);
    
    const totalWeight = transaction.signers.reduce((sum, s) => sum + s.weight, 0);
    const progress = totalWeight > 0 ? (signedWeight / transaction.minSignatures) * 100 : 0;
    
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
        
        if (hours > 0) {
          timeRemaining = `${hours}h ${minutes}m`;
        } else {
          timeRemaining = `${minutes}m`;
        }
      }
    }

    return {
      canSign: !isExpired && currentStep === "review",
      canSubmit: signedWeight >= transaction.minSignatures && currentStep !== "confirm",
      signedCount: transaction.signers.filter(s => s.hasSigned).length,
      requiredSignatures: transaction.minSignatures,
      progress: Math.min(progress, 100),
      isExpired,
      timeRemaining
    };
  }, [transaction, currentStep]);

  const value: MultisigContextType = useMemo(() => ({
    transaction,
    currentStep,
    isLoading,
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
    error, 
    isMounted, 
    isVisible,
    canSign,
    canSubmit,
    signedCount,
    requiredSignatures,
    progress,
    isExpired,
    timeRemaining
  } = useMultisig();
  
  return {
    transaction,
    currentStep,
    isLoading,
    error,
    isMounted,
    isVisible,
    canSign,
    canSubmit,
    signedCount,
    requiredSignatures,
    progress,
    isExpired,
    timeRemaining
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
    retryAction 
  } = useMultisig();
  
  return {
    setTransaction,
    setCurrentStep,
    signTransaction,
    submitTransaction,
    resetModal,
    clearError,
    retryAction
  };
}
