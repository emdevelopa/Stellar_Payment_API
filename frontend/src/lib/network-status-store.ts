import { create } from "zustand";

/**
 * Network status state
 */
export type NetworkStatus = "online" | "offline" | "slow" | "checking";

/**
 * Network status store interface
 */
interface NetworkStatusStore {
  status: NetworkStatus;
  lastChecked: Date | null;
  latency: number | null;
  connectionType: string | null;
  errorMessage: string | null;
  isMonitoring: boolean;

  // Actions
  setStatus: (status: NetworkStatus) => void;
  setLatency: (latency: number) => void;
  setConnectionType: (type: string) => void;
  setErrorMessage: (message: string | null) => void;
  setIsMonitoring: (monitoring: boolean) => void;
  checkStatus: () => Promise<void>;
  reset: () => void;
}

/**
 * Network Status Store using Zustand
 *
 * Manages network connectivity state and monitoring
 * with clean separation of concerns
 */
export const useNetworkStatusStore = create<NetworkStatusStore>((set) => {
  /**
   * Check network connectivity via API ping
   */
  const checkNetworkStatus = async () => {
    set({ status: "checking" });

    try {
      const startTime = performance.now();

      // Attempt to fetch a lightweight resource
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch("/api/health", {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });

      clearTimeout(timeout);
      const latency = Math.round(performance.now() - startTime);

      if (response.ok) {
        const newStatus: NetworkStatus =
          latency > 3000 ? "slow" : "online";

        set({
          status: newStatus,
          latency,
          lastChecked: new Date(),
          errorMessage: null,
        });
      } else {
        set({
          status: "offline",
          latency,
          lastChecked: new Date(),
          errorMessage: `API returned ${response.status}`,
        });
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Unknown error";

      set({
        status: "offline",
        latency: null,
        lastChecked: new Date(),
        errorMessage: errorMsg,
      });
    }
  };

  return {
    // Initial state
    status: "checking",
    lastChecked: null,
    latency: null,
    connectionType: null,
    errorMessage: null,
    isMonitoring: false,

    // Actions
    setStatus: (status) => set({ status }),
    setLatency: (latency) => set({ latency }),
    setConnectionType: (connectionType) => set({ connectionType }),
    setErrorMessage: (errorMessage) => set({ errorMessage }),
    setIsMonitoring: (isMonitoring) => set({ isMonitoring }),

    checkStatus: checkNetworkStatus,

    reset: () =>
      set({
        status: "checking",
        lastChecked: null,
        latency: null,
        connectionType: null,
        errorMessage: null,
        isMonitoring: false,
      }),
  };
});
