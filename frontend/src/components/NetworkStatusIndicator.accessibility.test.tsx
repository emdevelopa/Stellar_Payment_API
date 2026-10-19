import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { vi, describe, it, expect, beforeEach } from "vitest";
import NetworkStatusIndicator from "./NetworkStatusIndicator";
import { useNetworkStatusStore } from "@/lib/network-status-store";
import {
  ScreenReaderManager,
  FocusManager,
  AriaManager,
  AccessibilityTester,
} from "@/lib/accessibility-utils";

// Hoist shared mock functions so they're available in vi.mock factories
const {
  mockAnnounce,
  mockAnnounceStatusChange,
  mockAnnounceLatency,
  mockAnnounceConnectionType,
  mockAnnounceError,
  mockAnnounceQuality,
  mockSaveFocus,
  mockRestoreFocus,
  mockSetFocus,
  mockGetCurrentFocus,
} = vi.hoisted(() => ({
  mockAnnounce: vi.fn(),
  mockAnnounceStatusChange: vi.fn(),
  mockAnnounceLatency: vi.fn(),
  mockAnnounceConnectionType: vi.fn(),
  mockAnnounceError: vi.fn(),
  mockAnnounceQuality: vi.fn(),
  mockSaveFocus: vi.fn(),
  mockRestoreFocus: vi.fn(),
  mockSetFocus: vi.fn(),
  mockGetCurrentFocus: vi.fn(),
}));

// Mock the network status store
vi.mock("@/lib/network-status-store");
const mockUseNetworkStatusStore = vi.mocked(useNetworkStatusStore);

// Mock framer-motion
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    svg: ({ children, ...props }: any) => <svg {...props}>{children}</svg>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useAnimation: () => ({
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
  statusChangeFlashVariants: {},
  offlineAlertVariants: {},
  monitoringPulseVariants: {},
  latencyBarVariants: {},
  getLatencyVariant: () => "good",
  getConnectionQualityVariant: () => "excellent",
  getStatusDotVariant: () => "online",
  useReducedMotion: () => false,
  getAdaptiveTransition: (transition: any) => transition,
}));

// Mock accessibility utilities — use shared mock functions so component and test share instances
vi.mock("@/lib/accessibility-utils", () => ({
  useScreenReader: () => ({
    announce: mockAnnounce,
    announceStatusChange: mockAnnounceStatusChange,
    announceLatency: mockAnnounceLatency,
    announceConnectionType: mockAnnounceConnectionType,
    announceError: mockAnnounceError,
    announceQuality: mockAnnounceQuality,
  }),
  useFocusManagement: () => ({
    saveFocus: mockSaveFocus,
    restoreFocus: mockRestoreFocus,
    setFocus: mockSetFocus,
    getCurrentFocus: mockGetCurrentFocus,
  }),
  ScreenReaderManager: {
    getInstance: () => ({
      announce: vi.fn(),
      createLiveRegion: vi.fn(),
      clear: vi.fn(),
      cleanup: vi.fn(),
    }),
  },
  FocusManager: {
    getInstance: () => ({
      saveFocus: vi.fn(),
      restoreFocus: vi.fn(),
      setFocus: vi.fn(),
      getCurrentFocus: vi.fn(),
      clearHistory: vi.fn(),
    }),
  },
  AriaManager: {
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    setLabel: vi.fn(),
    setDescribedBy: vi.fn(),
    setLabelledBy: vi.fn(),
    setExpanded: vi.fn(),
    setPressed: vi.fn(),
    setDisabled: vi.fn(),
    setBusy: vi.fn(),
    setLiveRegion: vi.fn(),
    setAtomic: vi.fn(),
    setRelevant: vi.fn(),
  },
  KeyboardManager: {
    getInstance: () => ({
      addHandler: vi.fn(),
      handleEvent: vi.fn(),
      clear: vi.fn(),
    }),
  },
  AccessibilityTester: {
    checkAriaAttributes: vi.fn(),
    checkFocusManagement: vi.fn(),
    checkColorContrast: vi.fn(),
  },
}));

describe("NetworkStatusIndicator Accessibility", () => {
  const mockStore = {
    status: "online" as const,
    latency: 50,
    connectionType: "wifi",
    errorMessage: null,
    isMonitoring: true,
    lastChecked: null,
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
      const { rerender } = render(
        <NetworkStatusIndicator enableScreenReaderSupport={true} />
      );

      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        status: "offline",
      });

      rerender(<NetworkStatusIndicator enableScreenReaderSupport={true} />);

      expect(mockAnnounceStatusChange).toHaveBeenCalledWith(
        "online",
        "offline",
        expect.any(String)
      );
    });

    it("announces latency changes", () => {
      const { rerender } = render(
        <NetworkStatusIndicator enableScreenReaderSupport={true} />
      );

      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        latency: 150,
      });

      rerender(<NetworkStatusIndicator enableScreenReaderSupport={true} />);

      expect(mockAnnounceLatency).toHaveBeenCalledWith(150);
    });

    it("announces connection type changes", () => {
      const { rerender } = render(
        <NetworkStatusIndicator enableScreenReaderSupport={true} />
      );

      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        connectionType: "4g",
      });

      rerender(<NetworkStatusIndicator enableScreenReaderSupport={true} />);

      expect(mockAnnounceConnectionType).toHaveBeenCalledWith("4g");
    });

    it("announces errors to screen readers", () => {
      const { rerender } = render(
        <NetworkStatusIndicator enableScreenReaderSupport={true} />
      );

      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        errorMessage: "Connection failed",
      });

      rerender(<NetworkStatusIndicator enableScreenReaderSupport={true} />);

      expect(mockAnnounceError).toHaveBeenCalledWith("Connection failed");
    });

    it("provides hidden screen reader announcements", () => {
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);

      const srAnnouncements = screen
        .getByRole("region")
        .querySelector(".sr-only");
      expect(srAnnouncements).toBeInTheDocument();
    });

    it("announces connection quality when enabled", () => {
      render(
        <NetworkStatusIndicator
          enableScreenReaderSupport={true}
          showConnectionQuality={true}
        />
      );

      expect(mockAnnounceQuality).toHaveBeenCalled();
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

      fireEvent.keyDown(document, { key: "r", ctrlKey: true });

      expect(mockStore.checkStatus).toHaveBeenCalled();
    });

    it("handles Escape key for focus restoration", () => {
      render(<NetworkStatusIndicator enableKeyboardNavigation={true} />);

      fireEvent.keyDown(document, { key: "Escape" });

      expect(mockRestoreFocus).toHaveBeenCalled();
    });

    it("supports Enter and Space keys on refresh button", () => {
      render(<NetworkStatusIndicator enableKeyboardNavigation={true} />);

      const refreshButton = screen.getByLabelText("network.refresh");
      vi.clearAllMocks();

      fireEvent.keyDown(refreshButton, { key: "Enter" });
      expect(mockStore.checkStatus).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(refreshButton, { key: " " });
      expect(mockStore.checkStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe("Focus Management", () => {
    it("saves and restores focus properly", () => {
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);

      const refreshButton = screen.getByLabelText("network.refresh");
      fireEvent.click(refreshButton);

      expect(mockSaveFocus).toHaveBeenCalled();
    });

    it("manages focus during status changes", () => {
      render(<NetworkStatusIndicator enableKeyboardNavigation={true} />);

      const region = screen.getByRole("region");
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
      vi.mocked(AccessibilityTester.checkAriaAttributes).mockReturnValue({
        valid: true,
        issues: [],
      } as any);

      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);

      const region = screen.getByRole("region");
      AccessibilityTester.checkAriaAttributes(region);

      expect(AccessibilityTester.checkAriaAttributes).toHaveBeenCalledWith(region);
    });

    it("passes focus management validation", () => {
      vi.mocked(AccessibilityTester.checkFocusManagement).mockReturnValue({
        valid: true,
        issues: [],
      } as any);

      render(<NetworkStatusIndicator enableKeyboardNavigation={true} />);

      AccessibilityTester.checkFocusManagement();

      expect(AccessibilityTester.checkFocusManagement).toHaveBeenCalled();
    });

    it("passes color contrast validation", () => {
      vi.mocked(AccessibilityTester.checkColorContrast).mockReturnValue({
        valid: true,
        issues: [],
      } as any);

      render(<NetworkStatusIndicator />);

      const region = screen.getByRole("region");
      AccessibilityTester.checkColorContrast(region);

      expect(AccessibilityTester.checkColorContrast).toHaveBeenCalledWith(region);
    });
  });

  describe("Error Handling", () => {
    it("announces network restoration", () => {
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);

      fireEvent(window, new Event("online"));

      expect(mockAnnounce).toHaveBeenCalledWith(
        "Network connection restored",
        "assertive"
      );
    });

    it("announces network loss", () => {
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);

      fireEvent(window, new Event("offline"));

      expect(mockAnnounce).toHaveBeenCalledWith(
        "Network connection lost",
        "assertive"
      );
    });

    it("provides error announcements for failed checks", async () => {
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);

      const refreshButton = screen.getByLabelText("network.refresh");
      fireEvent.click(refreshButton);

      await waitFor(
        () => {
          expect(mockAnnounce).toHaveBeenCalledWith(
            expect.stringContaining("Network status check"),
            "polite"
          );
        },
        { timeout: 3000 }
      );
    });
  });

  describe("Performance and Accessibility", () => {
    it("respects reduced motion preferences", () => {
      render(<NetworkStatusIndicator enableScreenReaderSupport={true} />);

      expect(screen.getByRole("region")).toBeInTheDocument();
    });

    it("maintains accessibility with animations disabled", () => {
      render(<NetworkStatusIndicator enableMicroInteractions={false} />);

      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("aria-live", "polite");
    });

    it("handles rapid status changes gracefully", () => {
      const { rerender } = render(
        <NetworkStatusIndicator enableScreenReaderSupport={true} />
      );

      const statuses = ["offline", "checking", "slow", "online"];

      statuses.forEach((status) => {
        mockUseNetworkStatusStore.mockReturnValue({
          ...mockStore,
          status: status as any,
        });

        rerender(<NetworkStatusIndicator enableScreenReaderSupport={true} />);
      });

      expect(mockAnnounceStatusChange).toHaveBeenCalled();
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

      expect(mockStore.checkStatus).toHaveBeenCalled();
    });

    it("maintains accessibility with connection quality indicator", () => {
      render(
        <NetworkStatusIndicator
          showConnectionQuality={true}
          enableScreenReaderSupport={true}
        />
      );

      expect(screen.getByText("Connection Quality:")).toBeInTheDocument();
    });

    it("preserves accessibility when details are hidden", () => {
      render(
        <NetworkStatusIndicator
          showDetails={false}
          enableScreenReaderSupport={true}
        />
      );

      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).not.toHaveAttribute("aria-describedby");
    });
  });
});
