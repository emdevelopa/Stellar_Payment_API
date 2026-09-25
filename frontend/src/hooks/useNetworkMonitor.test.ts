import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNetworkMonitor } from "./useNetworkMonitor";
import { useNetworkStatusStore } from "@/lib/network-status-store";
import { useScreenReader, useFocusManagement } from "@/lib/accessibility-utils";

vi.mock("@/lib/network-status-store");
vi.mock("@/lib/accessibility-utils");

const mockCheckStatus = vi.fn();
const mockSetStatus = vi.fn();
const mockSetConnectionType = vi.fn();
const mockSetIsMonitoring = vi.fn();
const mockAnnounce = vi.fn();
const mockAnnounceStatusChange = vi.fn();
const mockAnnounceLatency = vi.fn();
const mockAnnounceConnectionType = vi.fn();
const mockAnnounceError = vi.fn();
const mockAnnounceQuality = vi.fn();
const mockSaveFocus = vi.fn();
const mockRestoreFocus = vi.fn();
const mockGetCurrentFocus = vi.fn();

const mockStore = {
  status: "online" as const,
  latency: 50,
  connectionType: "wifi",
  errorMessage: null,
  setStatus: mockSetStatus,
  setConnectionType: mockSetConnectionType,
  setIsMonitoring: mockSetIsMonitoring,
  checkStatus: mockCheckStatus,
};

const mockUseNetworkStatusStore = useNetworkStatusStore as ReturnType<typeof vi.fn>;
const mockUseScreenReader = useScreenReader as ReturnType<typeof vi.fn>;
const mockUseFocusManagement = useFocusManagement as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockUseNetworkStatusStore.mockReturnValue(mockStore);
  mockUseScreenReader.mockReturnValue({
    announce: mockAnnounce,
    announceStatusChange: mockAnnounceStatusChange,
    announceLatency: mockAnnounceLatency,
    announceConnectionType: mockAnnounceConnectionType,
    announceError: mockAnnounceError,
    announceQuality: mockAnnounceQuality,
  });
  mockUseFocusManagement.mockReturnValue({
    saveFocus: mockSaveFocus,
    restoreFocus: mockRestoreFocus,
    getCurrentFocus: mockGetCurrentFocus,
  });
});

describe("useNetworkMonitor", () => {
  describe("Monitoring setup", () => {
    it("calls checkStatus and setIsMonitoring on mount when autoCheck is true", () => {
      renderHook(() => useNetworkMonitor({ autoCheck: true }));

      expect(mockCheckStatus).toHaveBeenCalledTimes(1);
      expect(mockSetIsMonitoring).toHaveBeenCalledWith(true);
    });

    it("does not call checkStatus when autoCheck is false", () => {
      renderHook(() => useNetworkMonitor({ autoCheck: false }));

      expect(mockCheckStatus).not.toHaveBeenCalled();
      expect(mockSetIsMonitoring).not.toHaveBeenCalled();
    });

    it("sets isMonitoring to false on unmount", () => {
      const { unmount } = renderHook(() => useNetworkMonitor({ autoCheck: true }));
      vi.clearAllMocks();
      unmount();

      expect(mockSetIsMonitoring).toHaveBeenCalledWith(false);
    });

    it("detects and sets connection type on mount", () => {
      renderHook(() => useNetworkMonitor({ autoCheck: true }));

      expect(mockSetConnectionType).toHaveBeenCalledTimes(1);
    });
  });

  describe("Interval management", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sets up interval for periodic checks", async () => {
      renderHook(() => useNetworkMonitor({ autoCheck: true, checkInterval: 5000 }));
      vi.clearAllMocks();

      await vi.advanceTimersByTimeAsync(5000);

      expect(mockCheckStatus).toHaveBeenCalledTimes(1);
    });

    it("fires multiple intervals", async () => {
      renderHook(() => useNetworkMonitor({ autoCheck: true, checkInterval: 5000 }));
      vi.clearAllMocks();

      await vi.advanceTimersByTimeAsync(15000);

      expect(mockCheckStatus).toHaveBeenCalledTimes(3);
    });

    it("clears interval on unmount", async () => {
      const { unmount } = renderHook(() =>
        useNetworkMonitor({ autoCheck: true, checkInterval: 5000 })
      );
      vi.clearAllMocks();
      unmount();

      await vi.advanceTimersByTimeAsync(10000);

      expect(mockCheckStatus).not.toHaveBeenCalled();
    });
  });

  describe("handleRefresh", () => {
    it("calls checkStatus when status is not checking", () => {
      const { result } = renderHook(() => useNetworkMonitor({ autoCheck: false }));

      act(() => result.current.handleRefresh());

      expect(mockCheckStatus).toHaveBeenCalledTimes(1);
    });

    it("does not call checkStatus when status is checking", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        status: "checking",
      });

      const { result } = renderHook(() => useNetworkMonitor({ autoCheck: false }));

      act(() => result.current.handleRefresh());

      expect(mockCheckStatus).not.toHaveBeenCalled();
    });

    it("saves focus before refreshing", () => {
      const { result } = renderHook(() => useNetworkMonitor({ autoCheck: false }));

      act(() => result.current.handleRefresh());

      expect(mockSaveFocus).toHaveBeenCalledTimes(1);
    });

    it("announces check when screen reader support is enabled", () => {
      const { result } = renderHook(() =>
        useNetworkMonitor({
          autoCheck: false,
          enableScreenReaderSupport: true,
          announcementsEnabled: true,
        })
      );

      act(() => result.current.handleRefresh());

      expect(mockAnnounce).toHaveBeenCalledWith(
        "Checking network status",
        "polite"
      );
    });

    it("does not announce when screen reader support is disabled", () => {
      const { result } = renderHook(() =>
        useNetworkMonitor({
          autoCheck: false,
          enableScreenReaderSupport: false,
        })
      );

      act(() => result.current.handleRefresh());

      expect(mockAnnounce).not.toHaveBeenCalled();
    });

    it("does not announce when announcements are disabled", () => {
      const { result } = renderHook(() =>
        useNetworkMonitor({
          autoCheck: false,
          enableScreenReaderSupport: true,
          announcementsEnabled: false,
        })
      );

      act(() => result.current.handleRefresh());

      expect(mockAnnounce).not.toHaveBeenCalled();
    });
  });

  describe("Online/offline events", () => {
    it("sets status to online when online event fires", () => {
      renderHook(() => useNetworkMonitor({ autoCheck: false }));

      act(() => window.dispatchEvent(new Event("online")));

      expect(mockSetStatus).toHaveBeenCalledWith("online");
    });

    it("sets status to offline when offline event fires", () => {
      renderHook(() => useNetworkMonitor({ autoCheck: false }));

      act(() => window.dispatchEvent(new Event("offline")));

      expect(mockSetStatus).toHaveBeenCalledWith("offline");
    });

    it("announces connection restored on online event", () => {
      renderHook(() =>
        useNetworkMonitor({
          autoCheck: false,
          enableScreenReaderSupport: true,
          announcementsEnabled: true,
        })
      );

      act(() => window.dispatchEvent(new Event("online")));

      expect(mockAnnounce).toHaveBeenCalledWith(
        "Network connection restored",
        "assertive"
      );
    });

    it("announces connection lost on offline event", () => {
      renderHook(() =>
        useNetworkMonitor({
          autoCheck: false,
          enableScreenReaderSupport: true,
          announcementsEnabled: true,
        })
      );

      act(() => window.dispatchEvent(new Event("offline")));

      expect(mockAnnounce).toHaveBeenCalledWith(
        "Network connection lost",
        "assertive"
      );
    });

    it("does not announce browser events when screen reader support is disabled", () => {
      renderHook(() =>
        useNetworkMonitor({
          autoCheck: false,
          enableScreenReaderSupport: false,
        })
      );

      act(() => {
        window.dispatchEvent(new Event("online"));
        window.dispatchEvent(new Event("offline"));
      });

      expect(mockAnnounce).not.toHaveBeenCalled();
    });

    it("removes event listeners on unmount", () => {
      const { unmount } = renderHook(() =>
        useNetworkMonitor({ autoCheck: false })
      );
      unmount();

      act(() => window.dispatchEvent(new Event("online")));

      expect(mockSetStatus).not.toHaveBeenCalled();
    });
  });

  describe("Status change callbacks", () => {
    it("calls onStatusChange with current status on mount", () => {
      const onStatusChange = vi.fn();

      renderHook(() =>
        useNetworkMonitor({ autoCheck: false, onStatusChange })
      );

      expect(onStatusChange).toHaveBeenCalledWith("online");
    });

    it("does not throw when onStatusChange is not provided", () => {
      expect(() => {
        renderHook(() => useNetworkMonitor({ autoCheck: false }));
      }).not.toThrow();
    });
  });

  describe("Error announcements", () => {
    it("announces error message when present", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        errorMessage: "Connection timeout",
      });

      renderHook(() =>
        useNetworkMonitor({
          autoCheck: false,
          enableScreenReaderSupport: true,
          announcementsEnabled: true,
        })
      );

      expect(mockAnnounceError).toHaveBeenCalledWith("Connection timeout");
    });

    it("does not announce error when screen reader support is disabled", () => {
      mockUseNetworkStatusStore.mockReturnValue({
        ...mockStore,
        errorMessage: "Connection timeout",
      });

      renderHook(() =>
        useNetworkMonitor({
          autoCheck: false,
          enableScreenReaderSupport: false,
        })
      );

      expect(mockAnnounceError).not.toHaveBeenCalled();
    });
  });

  describe("Return values", () => {
    it("returns DOM refs", () => {
      const { result } = renderHook(() =>
        useNetworkMonitor({ autoCheck: false })
      );

      expect(result.current.statusRegionRef).toBeDefined();
      expect(result.current.detailsRegionRef).toBeDefined();
      expect(result.current.refreshButtonRef).toBeDefined();
    });

    it("returns handleRefresh function", () => {
      const { result } = renderHook(() =>
        useNetworkMonitor({ autoCheck: false })
      );

      expect(typeof result.current.handleRefresh).toBe("function");
    });
  });

  describe("Keyboard navigation", () => {
    it("triggers refresh on Ctrl+R when keyboard navigation is enabled", () => {
      renderHook(() =>
        useNetworkMonitor({
          autoCheck: false,
          enableKeyboardNavigation: true,
        })
      );
      vi.clearAllMocks();

      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "r",
            ctrlKey: true,
            bubbles: true,
          })
        );
      });

      expect(mockCheckStatus).toHaveBeenCalledTimes(1);
    });

    it("does not add keyboard listener when keyboard navigation is disabled", () => {
      renderHook(() =>
        useNetworkMonitor({
          autoCheck: false,
          enableKeyboardNavigation: false,
        })
      );
      vi.clearAllMocks();

      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "r",
            ctrlKey: true,
            bubbles: true,
          })
        );
      });

      expect(mockCheckStatus).not.toHaveBeenCalled();
    });

    it("removes keyboard listener on unmount", () => {
      const { unmount } = renderHook(() =>
        useNetworkMonitor({
          autoCheck: false,
          enableKeyboardNavigation: true,
        })
      );
      vi.clearAllMocks();
      unmount();

      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "r",
            ctrlKey: true,
            bubbles: true,
          })
        );
      });

      expect(mockCheckStatus).not.toHaveBeenCalled();
    });
  });

  describe("Default options", () => {
    it("uses default options when none are provided", () => {
      renderHook(() => useNetworkMonitor());

      expect(mockCheckStatus).toHaveBeenCalledTimes(1);
      expect(mockSetIsMonitoring).toHaveBeenCalledWith(true);
    });
  });
});
