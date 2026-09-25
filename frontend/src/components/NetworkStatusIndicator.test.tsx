import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import NetworkStatusIndicator from "./NetworkStatusIndicator";
import { useNetworkStatusStore } from "@/lib/network-status-store";

// Mock the network status store
vi.mock("@/lib/network-status-store");
const mockUseNetworkStatusStore = useNetworkStatusStore as ReturnType<typeof vi.fn>;

// Mock next-intl with proper translations for network keys
vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translations: Record<string, string> = {
      "network.status": "Network Status",
      "network.refresh": "Check network status",
      "network.latency": "Latency",
      "network.connection": "Connection",
      "network.error": "Error",
      "network.lastChecked": "Last checked",
      "network.online": "Online",
      "network.offline": "Offline",
      "network.slow": "Slow",
      "network.checking": "Checking...",
      "network.connectionQuality": "Connection Quality",
      "network.excellent": "Excellent",
      "network.good": "Good",
      "network.fair": "Fair",
      "network.poor": "Poor",
    };
    return (key: string) => translations[key] || key;
  },
}));

// Mock animation utilities
vi.mock("@/lib/network-animations", () => ({
  statusDotVariants: {},
  statusBadgeVariants: {},
  detailsPanelVariants: {},
  refreshButtonVariants: {},
  latencyVariants: {},
  connectionQualityVariants: {},
  errorMessageVariants: {},
  containerVariants: {},
  hoverEffectVariants: {},
  focusRingVariants: {},
  getLatencyVariant: () => "good",
  getConnectionQualityVariant: () => "excellent",
  getStatusDotVariant: () => "online",
  useReducedMotion: () => false,
  getAdaptiveTransition: (transition: any) => transition,
}));

describe("NetworkStatusIndicator", () => {
  const mockStore = {
    status: "online" as const,
    latency: 50,
    connectionType: "wifi",
    errorMessage: null,
    isMonitoring: true,
    setStatus: vi.fn(),
    setLatency: vi.fn(),
    setConnectionType: vi.fn(),
    setErrorMessage: vi.fn(),
    setIsMonitoring: vi.fn(),
    checkStatus: vi.fn(),
    reset: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseNetworkStatusStore.mockReturnValue(mockStore);
  });

  describe("Rendering", () => {
    it("renders network status indicator", () => {
      render(<NetworkStatusIndicator />);
      
      expect(screen.getByRole("region")).toBeInTheDocument();
      expect(screen.getByText("Online")).toBeInTheDocument();
    });

    it("displays latency when available", () => {
      render(<NetworkStatusIndicator />);
      
      expect(screen.getAllByText(/50/)[0]).toBeInTheDocument();
      expect(screen.getByText("(wifi)")).toBeInTheDocument();
    });

    it("displays connection type when available", () => {
      render(<NetworkStatusIndicator />);
      
      expect(screen.getByText("(wifi)")).toBeInTheDocument();
    });

    it("hides details when showDetails is false", () => {
      render(<NetworkStatusIndicator showDetails={false} />);
      
      expect(screen.queryByText("50ms")).not.toBeInTheDocument();
      expect(screen.queryByText("(wifi)")).not.toBeInTheDocument();
    });

    it("displays connection quality when enabled", () => {
      render(<NetworkStatusIndicator showConnectionQuality={true} />);
      
      expect(screen.getByText("Connection Quality:")).toBeInTheDocument();
      expect(screen.getByText("Good")).toBeInTheDocument();
    });

    it("hides connection quality when disabled", () => {
      render(<NetworkStatusIndicator showConnectionQuality={false} />);
      
      expect(screen.queryByText("Connection Quality:")).not.toBeInTheDocument();
      expect(screen.queryByText("Excellent")).not.toBeInTheDocument();
    });
  });

  describe("Status Display", () => {
    it("displays correct status for online", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        status: "online",
      });
      
      render(<NetworkStatusIndicator />);
      
      expect(screen.getByText("Online")).toBeInTheDocument();
    });

    it("displays correct status for offline", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        status: "offline",
      });
      
      render(<NetworkStatusIndicator />);
      
      expect(screen.getByText("Offline")).toBeInTheDocument();
    });

    it("displays correct status for slow", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        status: "slow",
      });
      
      render(<NetworkStatusIndicator />);
      
      expect(screen.getByText("Slow")).toBeInTheDocument();
    });

    it("displays correct status for checking", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        status: "checking",
      });
      
      render(<NetworkStatusIndicator />);
      
      const checkingElements = screen.getAllByText("Checking...");
      expect(checkingElements.length).toBeGreaterThanOrEqual(1);
    });

    it("displays error message when present", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        errorMessage: "Network error occurred",
      });
      
      render(<NetworkStatusIndicator />);
      
      expect(screen.getByText("Network error occurred")).toBeInTheDocument();
    });
  });

  describe("Refresh Functionality", () => {
    it("calls checkStatus when refresh button is clicked", () => {
      render(<NetworkStatusIndicator />);
      
      const refreshButton = screen.getByLabelText("Check network status");
      
      // Clear the initial check call
      vi.clearAllMocks();
      
      fireEvent.click(refreshButton);
      
      expect(mockStore.checkStatus).toHaveBeenCalledTimes(1);
    });

    it("disables refresh button when checking", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        status: "checking",
      });
      
      render(<NetworkStatusIndicator />);
      
      const refreshButton = screen.getByLabelText("Check network status");
      expect(refreshButton).toBeDisabled();
    });

    it("enables refresh button when not checking", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        status: "online",
      });
      
      render(<NetworkStatusIndicator />);
      
      const refreshButton = screen.getByLabelText("Check network status");
      expect(refreshButton).not.toBeDisabled();
    });
  });

  describe("Auto-check Functionality", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sets up auto-check when enabled", () => {
      render(<NetworkStatusIndicator autoCheck={true} checkInterval={5000} />);
      
      expect(mockStore.checkStatus).toHaveBeenCalledTimes(1); // Initial check
      expect(mockStore.setIsMonitoring).toHaveBeenCalledWith(true);
    });

    it("does not set up auto-check when disabled", () => {
      render(<NetworkStatusIndicator autoCheck={false} />);
      
      expect(mockStore.checkStatus).not.toHaveBeenCalled();
      expect(mockStore.setIsMonitoring).not.toHaveBeenCalled();
    });

    it("calls checkStatus at specified intervals", async () => {
      render(<NetworkStatusIndicator autoCheck={true} checkInterval={5000} />);
      
      // Clear initial call
      vi.clearAllMocks();
      
      // Fast-forward time
      await vi.advanceTimersByTimeAsync(5000);
      
      expect(mockStore.checkStatus).toHaveBeenCalledTimes(1);
    });

    it("cleans up interval on unmount", () => {
      const { unmount } = render(<NetworkStatusIndicator autoCheck={true} checkInterval={5000} />);
      
      unmount();
      
      expect(mockStore.setIsMonitoring).toHaveBeenCalledWith(false);
    });
  });

  describe("Status Change Callback", () => {
    it("calls onStatusChange when status changes", () => {
      const mockOnStatusChange = vi.fn();
      
      render(<NetworkStatusIndicator onStatusChange={mockOnStatusChange} />);
      
      expect(mockOnStatusChange).toHaveBeenCalledWith("online");
    });

    it("does not call onStatusChange when not provided", () => {
      expect(() => {
        render(<NetworkStatusIndicator />);
      }).not.toThrow();
    });
  });

  describe("Accessibility", () => {
    it("has correct ARIA attributes", () => {
      render(<NetworkStatusIndicator />);
      
      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("aria-label", "Network Status");
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).toHaveAttribute("aria-atomic", "true");
    });

    it("has accessible refresh button", () => {
      render(<NetworkStatusIndicator />);
      
      const refreshButton = screen.getByLabelText("Check network status");
      expect(refreshButton).toBeInTheDocument();
    });

    it("announces status changes", () => {
      const { rerender } = render(<NetworkStatusIndicator />);
      
      expect(screen.getByRole("region")).toHaveAttribute("aria-live", "polite");
    });
  });

  describe("Connection Quality", () => {
    it("shows excellent quality for low latency", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        latency: 30,
      });
      
      render(<NetworkStatusIndicator showConnectionQuality={true} />);
      
      expect(screen.getByText("Excellent")).toBeInTheDocument();
    });

    it("shows good quality for medium latency", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        latency: 100,
      });
      
      render(<NetworkStatusIndicator showConnectionQuality={true} />);
      
      expect(screen.getByText("Good")).toBeInTheDocument();
    });

    it("shows fair quality for high latency", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        latency: 200,
      });
      
      render(<NetworkStatusIndicator showConnectionQuality={true} />);
      
      expect(screen.getByText("Fair")).toBeInTheDocument();
    });

    it("shows poor quality for very high latency", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        latency: 400,
      });
      
      render(<NetworkStatusIndicator showConnectionQuality={true} />);
      
      expect(screen.getByText("Poor")).toBeInTheDocument();
    });

    it("hides quality indicator when latency is null", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        latency: null,
      });
      
      render(<NetworkStatusIndicator showConnectionQuality={true} />);
      
      expect(screen.queryByText("Connection Quality:")).not.toBeInTheDocument();
    });
  });

  describe("Error States", () => {
    it("displays error message clearly", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        errorMessage: "Failed to connect to server",
      });
      
      render(<NetworkStatusIndicator />);
      
      expect(screen.getByText("Failed to connect to server")).toBeInTheDocument();
    });

    it("shows error styling for error messages", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        errorMessage: "Network error",
      });
      
      render(<NetworkStatusIndicator />);
      
      const errorElement = screen.getByText("Network error").closest(".rounded");
      expect(errorElement).toHaveClass("bg-red-50");
    });

    it("shows last checked time when online and no errors", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        status: "online",
        errorMessage: null,
      });
      
      render(<NetworkStatusIndicator />);
      
      expect(screen.getByText(/Last checked/)).toBeInTheDocument();
    });

    it("hides last checked time when there are errors", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        status: "offline",
        errorMessage: "Connection failed",
      });
      
      render(<NetworkStatusIndicator />);
      
      expect(screen.queryByText(/Last checked/)).not.toBeInTheDocument();
    });
  });

  describe("Micro-interactions", () => {
    it("enables micro-interactions by default", () => {
      render(<NetworkStatusIndicator />);
      
      expect(screen.getByRole("region")).toBeInTheDocument();
    });

    it("disables micro-interactions when specified", () => {
      render(<NetworkStatusIndicator enableMicroInteractions={false} />);
      
      expect(screen.getByRole("region")).toBeInTheDocument();
    });
  });

  describe("Performance", () => {
    it("renders efficiently with default props", () => {
      const startTime = performance.now();
      
      render(<NetworkStatusIndicator />);
      
      const endTime = performance.now();
      const renderTime = endTime - startTime;
      
      expect(renderTime).toBeLessThan(200);
    });

    it("handles rapid status changes efficiently", () => {
      const { rerender } = render(<NetworkStatusIndicator />);
      
      const statuses = ["online", "offline", "checking", "slow", "online"];
      
      statuses.forEach((status) => {
        mockUseNetworkStatusStore.mockReturnValue({
          ...mockStore,
          status: status as any,
        });
        
        rerender(<NetworkStatusIndicator />);
      });
      
      expect(screen.getByRole("region")).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    it("handles null connection type gracefully", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        connectionType: null,
      });
      
      render(<NetworkStatusIndicator />);
      
      expect(screen.queryByText(/\(/)).not.toBeInTheDocument();
    });

    it("handles unknown connection type gracefully", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        connectionType: "unknown",
      });
      
      render(<NetworkStatusIndicator />);
      
      expect(screen.queryByText(/\(/)).not.toBeInTheDocument();
    });

    it("handles zero latency gracefully", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        latency: 0,
      });
      
      render(<NetworkStatusIndicator />);
      
      expect(screen.getAllByText(/0/)[0]).toBeInTheDocument();
    });

    it("handles very high latency gracefully", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        latency: 9999,
      });
      
      render(<NetworkStatusIndicator showConnectionQuality={true} />);
      
      expect(screen.getAllByText(/9999/)[0]).toBeInTheDocument();
      expect(screen.getByText("Poor")).toBeInTheDocument();
    });
  });
});
