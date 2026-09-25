import { useCallback, useRef, useEffect } from "react";

export function useMultisigPerformance() {
  const renderCountRef = useRef(0);
  const signAttemptsRef = useRef(0);
  const submitAttemptsRef = useRef(0);
  const lastActionRef = useRef<number>(Date.now());

  useEffect(() => {
    renderCountRef.current += 1;
  });

  const trackSignAttempt = useCallback(() => {
    signAttemptsRef.current += 1;
    lastActionRef.current = Date.now();
  }, []);

  const trackSubmitAttempt = useCallback(() => {
    submitAttemptsRef.current += 1;
    lastActionRef.current = Date.now();
  }, []);

  const getPerformanceMetrics = useCallback(() => {
    return {
      renderCount: renderCountRef.current,
      signAttempts: signAttemptsRef.current,
      submitAttempts: submitAttemptsRef.current,
      lastAction: lastActionRef.current,
      timeSinceLastAction: Date.now() - lastActionRef.current,
    };
  }, []);

  return {
    trackSignAttempt,
    trackSubmitAttempt,
    getPerformanceMetrics,
  };
}

export function useMultisigDebounce(callback: () => void, delay: number) {
  const timeoutRef = useRef<NodeJS.Timeout>();

  const debouncedCallback = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(callback, delay);
  }, [callback, delay]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

export function validateMultisigTransaction(transaction: any): boolean {
  if (!transaction || typeof transaction !== "object") return false;
  
  const requiredFields = ["id", "sourceAccount", "destination", "amount", "assetCode", "minSignatures", "signers"];
  for (const field of requiredFields) {
    if (!(field in transaction)) return false;
  }

  if (!Array.isArray(transaction.signers) || transaction.signers.length === 0) {
    return false;
  }

  const totalWeight = transaction.signers.reduce((sum: number, signer: any) => {
    return sum + (typeof signer.weight === "number" ? signer.weight : 0);
  }, 0);

  if (transaction.minSignatures > totalWeight) {
    return false;
  }

  return true;
}

export function sanitizeSignerInput(input: unknown): any | null {
  if (!input || typeof input !== "object") return null;
  
  const signer = input as any;
  
  return {
    id: typeof signer.id === "string" ? signer.id.trim() : "",
    publicKey: typeof signer.publicKey === "string" ? signer.publicKey.trim() : "",
    name: typeof signer.name === "string" ? signer.name.trim() : undefined,
    weight: typeof signer.weight === "number" && signer.weight > 0 ? signer.weight : 1,
    hasSigned: Boolean(signer.hasSigned),
    signature: typeof signer.signature === "string" ? signer.signature.trim() : undefined,
    signedAt: typeof signer.signedAt === "string" ? signer.signedAt : undefined,
  };
}

export function validateSigner(signer: any): boolean {
  if (!signer || typeof signer !== "object") return false;
  
  return (
    typeof signer.id === "string" && signer.id.length > 0 &&
    typeof signer.publicKey === "string" && signer.publicKey.length > 0 &&
    typeof signer.weight === "number" && signer.weight > 0 &&
    typeof signer.hasSigned === "boolean"
  );
}

export function calculateSignatureProgress(signers: any[], minSignatures: number): number {
  if (!Array.isArray(signers) || minSignatures <= 0) return 0;
  
  const signedWeight = signers
    .filter(signer => validateSigner(signer) && signer.hasSigned)
    .reduce((sum, signer) => sum + signer.weight, 0);
  
  return Math.min((signedWeight / minSignatures) * 100, 100);
}

export function checkTransactionExpiry(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  
  try {
    const expiry = new Date(expiresAt);
    const now = new Date();
    return now >= expiry;
  } catch {
    return false;
  }
}

export function getTimeRemaining(expiresAt?: string): string | null {
  if (!expiresAt) return null;
  
  try {
    const expiry = new Date(expiresAt);
    const now = new Date();
    
    if (now >= expiry) return null;
    
    const diff = expiry.getTime() - now.getTime();
    
    if (diff <= 0) return null;
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    }
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    
    if (minutes > 0) {
      return `${minutes}m`;
    }
    
    return "< 1m";
  } catch {
    return null;
  }
}

export function generateMockTransactionHash(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `tx_${timestamp}_${random}`;
}

export function generateMockSignature(signerId: string): string {
  const timestamp = Date.now();
  return `mock_signature_${timestamp}_${signerId}`;
}

export function isValidStellarAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  
  // Stellar addresses start with 'G' and are 56 characters long
  return /^G[A-Z0-9]{55}$/.test(address);
}

export function isValidAmount(amount: string | number): boolean {
  if (typeof amount === "number") {
    return amount > 0 && Number.isFinite(amount);
  }
  
  if (typeof amount === "string") {
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0 && Number.isFinite(num);
  }
  
  return false;
}

export function formatAssetAmount(amount: string | number, assetCode: string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  
  if (!Number.isFinite(num)) return "0";
  
  // Format based on asset type
  if (assetCode === "XLM") {
    // XLM typically uses 7 decimal places
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 7,
    });
  }
  
  // Other assets typically use less precision
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function truncateAddress(address: string, startChars: number = 8, endChars: number = 8): string {
  if (!address || typeof address !== "string") return "";
  
  if (address.length <= startChars + endChars) {
    return address;
  }
  
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}
