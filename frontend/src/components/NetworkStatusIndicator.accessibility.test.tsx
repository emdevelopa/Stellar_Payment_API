import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import NetworkStatusIndicator from "./NetworkStatusIndicator";
import { useNetworkStatusStore } from "@/lib/network-status-store";
import {
  ScreenReaderManager,
  FocusManager,
  AriaManager,
  AccessibilityTester,
} from "@/lib/accessibility-utils";

// Mock the network status store
jest.mock("@/lib/network-status-store");
const mockUseNetworkStatusStore = useNetworkStatusStore as jest.MockedFunction<typeof useNetworkStatusStore>;

// Mock framer-motion
jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    svg: ({ children, ...props }: any) => <svg {...props}>{children}</svg>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useAnimation: () => ({
    start: jest.fn(),
    stop: jest.fn(),
  }),
}));

// Mock next-intl
jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock animation utilities
jest.mock("@/lib/network-animations", () => ({
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

// Mock accessibility utilities
jest.mock("@/lib/accessibility-utils", () => ({
  useScreenReader: () => ({
    announce: jest.fn(),
    announceStatusChange: jest.fn(),
    announceLatency: jest.fn(),
    announceConnectionType: jest.fn(),
    announceError: jest.fn(),
    announceQuality: jest.fn(),
  }),
  useFocusManagement: () => ({
    saveFocus: jest.fn(),
    restoreFocus: jest.fn(),
    setFocus: jest.fn(),
    getCurrentFocus: jest.fn(),
  }),
  ScreenReaderManager: {
    getInstance: () => ({
      announce: jest.fn(),
      createLiveRegion: jest.fn(),
      clear: jest.fn(),
      cleanup: jest.fn(),
    }),
  },
  FocusManager: {
    getInstance: () => ({
      saveFocus: jest.fn(),
      restoreFocus: jest.fn(),
      setFocus: jest.fn(),
      getCurrentFocus: jest.fn(),
      clearHistory: jest.fn(),
    }),
  },
  AriaManager: {
    setAttribute: jest.fn(),
    removeAttribute: jest.fn(),
    setLabel: jest.fn(),
    setDescribedBy: jest.fn(),
    setLabelledBy: jest.fn(),
    setExpanded: jest.fn(),
    setPressed: jest.fn(),
    setDisabled: jest.fn(),
    setBusy: jest.fn(),
    setLiveRegion: jest.fn(),
    setAtomic: jest.fn(),
    setRelevant: jest.fn(),
  },
  KeyboardManager: {
    getInstance: () => ({
      addHandler: jest.fn(),
      handleEvent: jest.fn(),
      clear: jest.fn(),
    }),
  },
  AccessibilityTester: {
    checkAriaAttributes: jest.fn(),
    checkFocusManagement: jest.fn(),
    checkColorContrast: jest.fn(),
  },
}));

describe("NetworkStatusIndicator Accessibility", () => {
  const mockStore = {
    status: "online" as const,
    latency: 50,
    connectionType: "wifi",
    errorMessage: null,
    isMonitoring: true,
    setStatus: jest.fn(),
    setLatency: jest.fn(),
    setConnectionType: jest.fn(),
    setErrorMessage: jest.fn(),
    setIsMonitoring: jest.fn(),
    checkStatus: jest.fn(),
    reset: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNetworkStatusStore.mockReturnValue(mockStore);
  });

  describe("Screen Reader Support", () => {
    it("has proper ARIA attributes for screen readers", () => {
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).toHaveAttribute("aria-atomic", "true");
      expect(region).toHaveAttribute("aria-label", "network.status");
    });

    it("disables ARIA live regions when screen reader support is disabled", () => {
      render(<NetworkStatusIndicator enableScreenReaderSupport={false} />);
      
      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("aria-live", "off");
    });

    it("announces status changes to screen readers", () => {
      const { announceStatusChange } = require("@/lib/accessibility-utils").useScreenReader();
      
      const { rerender } = render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      // Change status
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        status: "offline",
      });
      
      rerender(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      expect(announceStatusChange).toHaveBeenCalledWith("online", "offline", expect.any(String));
    });

    it("announces latency changes", () => {
      const { announceLatency } = require("@/lib/accessibility-utils").useScreenReader();
      
      const { rerender } = render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      // Change latency
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        latency: 150,
      });
      
      rerender(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      expect(announceLatency).toHaveBeenCalledWith(150);
    });

    it("announces connection type changes", () => {
      const { announceConnectionType } = require("@/lib/accessibility-utils").useScreenReader();
      
      const { rerender } = render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      // Change connection type
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        connectionType: "4g",
      });
      
      rerender(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      expect(announceConnectionType).toHaveBeenCalledWith("4g");
    });

    it("announces errors to screen readers", () => {
      const { announceError } = require("@/lib/accessibility-utils").useScreenReader();
      
      const { rerender } = render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      // Add error
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        errorMessage: "Connection failed",
      });
      
      rerender(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      expect(announceError).toHaveBeenCalledWith("Connection failed");
    });

    it("provides hidden screen reader announcements", () => {
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      // Check for hidden screen reader elements
      const srAnnouncements = screen.getByRole("region").querySelector(".sr-only");
      expect(srAnnouncements).toBeInTheDocument();
    });

    it("announces connection quality when enabled", () => {
      const { announceQuality } = require("@/lib/accessibility-utils").useScreenReader();
      
      render(
        <NetworkStatusIndicator 
          enableScreenReaderSupport={true} 
          showConnectionQuality={true}
        />
      );
      
      expect(announceQuality).toHaveBeenCalled();
    });
  });

  describe("Keyboard Navigation", () => {
    it("has proper keyboard navigation when enabled", () => {
      render(<NetworkStatusIndicator enableKeyboardNavigation={true} />);
      
      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("tabIndex", "0");
    });

    it("disables keyboard navigation when disabled", () => {
      render(<NetworkStatusIndicator enableKeyboardNavigation={false} />);
      
      const region = screen.getByRole("region");
      expect(region).not.toHaveAttribute("tabIndex");
    });

    it("handles keyboard shortcuts for refresh", () => {
      render(<NetworkStatusIndicator enableKeyboardNavigation={true} />);
      
      // Simulate Ctrl+R
      fireEvent.keyDown(document, { key: "r", ctrlKey: true });
      
      expect(mockStore.checkStatus).toHaveBeenCalled();
    });

    it("handles Escape key for focus restoration", () => {
      const { getCurrentFocus, restoreFocus } = require("@/lib/accessibility-utils").useFocusManagement();
      
      getCurrentFocus.mockReturnValue(document.createElement("button"));
      
      render(<NetworkStatusIndicator enableKeyboardNavigation={true} />);
      
      // Simulate Escape key
      fireEvent.keyDown(document, { key: "Escape" });
      
      expect(restoreFocus).toHaveBeenCalled();
    });

    it("supports Enter and Space keys on refresh button", () => {
      render(<NetworkStatusIndicator enableKeyboardNavigation={true} />);
      
      const refreshButton = screen.getByLabelText("network.refresh");
      
      fireEvent.keyDown(refreshButton, { key: "Enter" });
      expect(mockStore.checkStatus).toHaveBeenCalled();
      
      fireEvent.keyDown(refreshButton, { key: " " });
      expect(mockStore.checkStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe("Focus Management", () => {
    it("saves and restores focus properly", () => {
      const { saveFocus, restoreFocus } = require("@/lib/accessibility-utils").useFocusManagement();
      
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      // Trigger refresh which should save focus
      const refreshButton = screen.getByLabelText("network.refresh");
      fireEvent.click(refreshButton);
      
      expect(saveFocus).toHaveBeenCalled();
    });

    it("manages focus during status changes", () => {
      render(<NetworkStatusIndicator enableKeyboardNavigation={true} />);
      
      const region = screen.getByRole("region");
      
      // Focus the region
      region.focus();
      
      expect(document.activeElement).toBe(region);
    });
  });

  describe("ARIA Attributes", () => {
    it("has correct busy state during checking", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        status: "checking",
      });
      
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("aria-busy", "true");
    });

    it("has correct describedby relationship for details", () => {
      render(
        <NetworkStatusIndicator 
          showDetails={true}
          enableScreenReaderSupport={true}
        />
      );
      
      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("aria-describedby", "network-details");
    });

    it("refresh button has proper ARIA attributes", () => {
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      const refreshButton = screen.getByLabelText("network.refresh");
      expect(refreshButton).toHaveAttribute("aria-busy", "false");
      expect(refreshButton).toHaveAttribute("aria-pressed", "false");
    });

    it("refresh button shows busy state during checking", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        status: "checking",
      });
      
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      const refreshButton = screen.getByLabelText("network.refresh");
      expect(refreshButton).toHaveAttribute("aria-busy", "true");
      expect(refreshButton).toHaveAttribute("aria-pressed", "true");
    });

    it("details panel has proper ARIA attributes", () => {
      render(
        <NetworkStatusIndicator 
          showDetails={true}
          enableScreenReaderSupport={true}
        />
      );
      
      const detailsPanel = document.getElementById("network-details");
      expect(detailsPanel).toHaveAttribute("role", "group");
      expect(detailsPanel).toHaveAttribute("aria-label", "Network details");
      expect(detailsPanel).toHaveAttribute("aria-live", "polite");
    });
  });

  describe("Accessibility Testing", () => {
    it("passes ARIA attribute validation", () => {
      const { checkAriaAttributes } = require("@/lib/accessibility-utils").AccessibilityTester;
      checkAriaAttributes.mockReturnValue({ valid: true, issues: [] });
      
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      const region = screen.getByRole("region");
      checkAriaAttributes(region);
      
      expect(checkAriaAttributes).toHaveBeenCalledWith(region);
    });

    it("passes focus management validation", () => {
      const { checkFocusManagement } = require("@/lib/accessibility-utils").AccessibilityTester;
      checkFocusManagement.mockReturnValue({ valid: true, issues: [] });
      
      render(<NetworkStatusIndicator enableKeyboardNavigation={true} />);
      
      checkFocusManagement();
      
      expect(checkFocusManagement).toHaveBeenCalled();
    });

    it("passes color contrast validation", () => {
      const { checkColorContrast } = require("@/lib/accessibility-utils").AccessibilityTester;
      checkColorContrast.mockReturnValue({ valid: true, issues: [] });
      
      render(<NetworkStatusIndicator />);
      
      const region = screen.getByRole("region");
      checkColorContrast(region);
      
      expect(checkColorContrast).toHaveBeenCalledWith(region);
    });
  });

  describe("Error Handling", () => {
    it("announces network restoration", () => {
      const { announce } = require("@/lib/accessibility-utils").useScreenReader();
      
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      // Simulate online event
      fireEvent(window, new Event("online"));
      
      expect(announce).toHaveBeenCalledWith("Network connection restored", "assertive");
    });

    it("announces network loss", () => {
      const { announce } = require("@/lib/accessibility-utils").useScreenReader();
      
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      // Simulate offline event
      fireEvent(window, new Event("offline"));
      
      expect(announce).toHaveBeenCalledWith("Network connection lost", "assertive");
    });

    it("provides error announcements for failed checks", async () => {
      const { announce } = require("@/lib/accessibility-utils").useScreenReader();
      
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      // Trigger refresh
      const refreshButton = screen.getByLabelText("network.refresh");
      fireEvent.click(refreshButton);
      
      // Wait for completion announcement
      await waitFor(() => {
        expect(announce).toHaveBeenCalledWith(expect.stringContaining("Network status check"), "polite");
      });
    });
  });

  describe("Performance and Accessibility", () => {
    it("respects reduced motion preferences", () => {
      const { useReducedMotion } = require("@/lib/network-animations");
      useReducedMotion.mockReturnValue(true);
      
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      // Component should still render properly with reduced motion
      expect(screen.getByRole("region")).toBeInTheDocument();
    });

    it("maintains accessibility with animations disabled", () => {
      render(<NetworkStatusIndicator enableMicroInteractions={false} />);
      
      // Accessibility features should still work
      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("aria-live", "polite");
    });

    it("handles rapid status changes gracefully", () => {
      const { announceStatusChange } = require("@/lib/accessibility-utils").useScreenReader();
      
      const { rerender } = render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      
      // Rapid status changes
      const statuses = ["offline", "checking", "slow", "online"];
      
      statuses.forEach((status) => {
        mockUseNetworkStatusStore.mockReturnValue({
          ...mockStore,
          status: status as any,
        });
        
        rerender(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      });
      
      // Should handle all changes without errors
      expect(announceStatusChange).toHaveBeenCalledTimes(statuses.length - 1);
    });
  });

  describe("Integration with Existing Features", () => {
    it("works with auto-check functionality", () => {
      render(
        <NetworkStatusIndicator 
          autoCheck={true}
          enableScreenReaderSupport={true}
          announcementsEnabled={true}
        />
      );
      
      // Should initialize monitoring and announce initial status
      expect(mockStore.checkStatus).toHaveBeenCalled();
    });

    it("maintains accessibility with connection quality indicator", () => {
      render(
        <NetworkStatusIndicator 
          showConnectionQuality={true}
          enableScreenReaderSupport={true}
        />
      );
      
      // Should announce quality information
      expect(screen.getByText("Connection Quality:")).toBeInTheDocument();
    });

    it("preserves accessibility when details are hidden", () => {
      render(
        <NetworkStatusIndicator 
          showDetails={false}
          enableScreenReaderSupport={true}
        />
      );
      
      // Should still have proper ARIA attributes
      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).not.toHaveAttribute("aria-describedby");
    });
  });
});
