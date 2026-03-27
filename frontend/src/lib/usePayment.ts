import { useState, useCallback } from "react";
import { submitTransaction } from "@/lib/freighter";
import { buildPaymentTransaction } from "@/lib/stellar";
import type { WalletProvider } from "@/lib/wallet-types";

interface PaymentParams {
  recipient: string;
  amount: string;
  assetCode: string;
  assetIssuer: string | null;
}

interface UsePaymentReturn {
  isProcessing: boolean;
  status: string | null;
  error: string | null;
  processPayment: (params: PaymentParams) => Promise<{ hash: string }>;
}

/**
 * Hook for processing payments with any WalletProvider.
 *
 * Pass the active provider returned by `useWallet()`. Falls back to a
 * descriptive error when no provider is selected.
 */
export function usePayment(provider: WalletProvider | null): UsePaymentReturn {
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const processPayment = useCallback(
    async (params: PaymentParams): Promise<{ hash: string }> => {
      if (!provider) throw new Error("No wallet provider selected");

      setIsProcessing(true);
      setStatus("Connecting to wallet...");
      setError(null);

      try {
        // Get the public key from the active provider
        setStatus("Requesting account from wallet...");
        const publicKey = await provider.getPublicKey();

        // Get network configuration
        const networkUrl =
          process.env.NEXT_PUBLIC_HORIZON_URL ||
          "https://horizon-testnet.stellar.org";
        const networkPassphrase =
          process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ||
          "Test SDF Network ; September 2015";

        // Build the transaction
        setStatus("Building transaction...");
        const transactionXDR = await buildPaymentTransaction({
          sourcePublicKey: publicKey,
          destinationPublicKey: params.recipient,
          amount: params.amount,
          assetCode: params.assetCode,
          assetIssuer: params.assetIssuer,
          horizonUrl: networkUrl,
          networkPassphrase,
        });

        // Sign with the active provider
        setStatus("Signing transaction...");
        const signedXDR = await provider.signTransaction(
          transactionXDR,
          networkPassphrase,
        );

        // Submit the transaction
        setStatus("Submitting transaction...");
        const result = await submitTransaction(
          signedXDR,
          networkUrl,
          networkPassphrase,
        );

        setStatus("Payment completed successfully!");
        return result;
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Unknown error occurred";
        setError(errorMsg);
        setStatus(null);
        throw err;
      } finally {
        setIsProcessing(false);
      }
    },
    [provider],
  );

  return {
    isProcessing,
    status,
    error,
    processPayment,
  };
}
