import { useState, useCallback } from "react";
import { toast } from "sonner";

interface UseOptimisticUpdateOptions<T> {
  onSuccess?: (data: T) => void;
  onError?: (error: Error, rollbackValue: T) => void;
  retryCount?: number;
}

/**
 * Custom hook for handling optimistic updates with rollback capability.
 */
export function useOptimisticUpdate<T>(
  initialState: T,
  options: UseOptimisticUpdateOptions<T> = {}
) {
  const [state, setState] = useState<T>(initialState);
  const [isPending, setIsPending] = useState(false);

  const executeUpdate = useCallback(
    async (
      updateFn: (currentState: T) => T,
      apiFn: () => Promise<void>
    ) => {
      const previousState = state;
      const optimisticState = updateFn(previousState);

      // Apply optimistic update
      setState(optimisticState);
      setIsPending(true);

      try {
        await apiFn();
        options.onSuccess?.(optimisticState);
      } catch (error) {
        // Rollback on error
        setState(previousState);
        const err = error instanceof Error ? error : new Error("Update failed");
        options.onError?.(err, previousState);
        toast.error(err.message || "Something went wrong. Reverting changes.");
      } finally {
        setIsPending(false);
      }
    },
    [state, options]
  );

  return {
    state,
    setState,
    isPending,
    executeUpdate,
  };
}
