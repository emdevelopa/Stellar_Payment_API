/**
 * Accessibility utilities for enhanced screen reader support
 * Provides comprehensive ARIA management, screen reader announcements, and focus handling
 */

export interface ScreenReaderAnnouncement {
  message: string;
  priority: "polite" | "assertive";
  timeout?: number;
}

export interface AccessibilityRegion {
  id: string;
  element: HTMLElement | null;
  announcements: ScreenReaderAnnouncement[];
}

/**
 * Screen reader announcement system
 */
export class ScreenReaderManager {
  private static instance: ScreenReaderManager;
  private regions: Map<string, AccessibilityRegion> = new Map();
  private announcementQueue: ScreenReaderAnnouncement[] = [];
  private isProcessing = false;

  static getInstance(): ScreenReaderManager {
    if (!ScreenReaderManager.instance) {
      ScreenReaderManager.instance = new ScreenReaderManager();
    }
    return ScreenReaderManager.instance;
  }

  /**
   * Create or get an accessibility region
   */
  getRegion(id: string): AccessibilityRegion {
    if (!this.regions.has(id)) {
      const element = document.getElementById(`sr-region-${id}`);
      this.regions.set(id, {
        id,
        element,
        announcements: [],
      });
    }
    return this.regions.get(id)!;
  }

  /**
   * Create a live region for screen reader announcements
   */
  createLiveRegion(id: string, priority: "polite" | "assertive" = "polite"): HTMLElement {
    let region = document.getElementById(`sr-region-${id}`);
    
    if (!region) {
      region = document.createElement("div");
      region.id = `sr-region-${id}`;
      region.setAttribute("aria-live", priority);
      region.setAttribute("aria-atomic", "true");
      region.setAttribute("aria-relevant", "additions text");
      region.className = "sr-only";
      region.style.position = "absolute";
      region.style.left = "-10000px";
      region.style.width = "1px";
      region.style.height = "1px";
      region.style.overflow = "hidden";
      document.body.appendChild(region);
    }

    this.regions.set(id, {
      id,
      element: region,
      announcements: [],
    });

    return region;
  }

  /**
   * Announce a message to screen readers
   */
  announce(message: string, priority: "polite" | "assertive" = "polite", timeout?: number): void {
    const announcement: ScreenReaderAnnouncement = {
      message,
      priority,
      timeout,
    };

    this.announcementQueue.push(announcement);
    this.processQueue();
  }

  /**
   * Process the announcement queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.announcementQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.announcementQueue.length > 0) {
      const announcement = this.announcementQueue.shift()!;
      await this.deliverAnnouncement(announcement);
    }

    this.isProcessing = false;
  }

  /**
   * Deliver a single announcement
   */
  private async deliverAnnouncement(announcement: ScreenReaderAnnouncement): Promise<void> {
    const regionId = announcement.priority === "assertive" ? "assertive" : "polite";
    const region = this.getRegion(regionId);

    if (!region.element) {
      region.element = this.createLiveRegion(regionId, announcement.priority);
    }

    // Clear previous content
    region.element.textContent = "";

    // Add the new announcement
    region.element.textContent = announcement.message;

    // Wait a bit before clearing (for screen readers to process)
    await new Promise(resolve => setTimeout(resolve, 100));

    if (announcement.timeout) {
      setTimeout(() => {
        if (region.element) {
          region.element.textContent = "";
        }
      }, announcement.timeout);
    }
  }

  /**
   * Clear all announcements
   */
  clear(): void {
    this.announcementQueue = [];
    this.regions.forEach(region => {
      if (region.element) {
        region.element.textContent = "";
      }
    });
  }

  /**
   * Clean up regions
   */
  cleanup(): void {
    this.regions.forEach(region => {
      if (region.element && region.element.parentNode) {
        region.element.parentNode.removeChild(region.element);
      }
    });
    this.regions.clear();
    this.announcementQueue = [];
  }
}

/**
 * Focus management utilities
 */
export class FocusManager {
  private static instance: FocusManager;
  private focusHistory: HTMLElement[] = [];
  private currentFocus: HTMLElement | null = null;

  static getInstance(): FocusManager {
    if (!FocusManager.instance) {
      FocusManager.instance = new FocusManager();
    }
    return FocusManager.instance;
  }

  /**
   * Save current focus to history
   */
  saveFocus(): void {
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement && activeElement !== document.body) {
      this.focusHistory.push(activeElement);
      this.currentFocus = activeElement;
    }
  }

  /**
   * Restore focus from history
   */
  restoreFocus(): void {
    if (this.focusHistory.length > 0) {
      const previousFocus = this.focusHistory.pop();
      if (previousFocus) {
        previousFocus.focus();
        this.currentFocus = previousFocus;
      }
    }
  }

  /**
   * Set focus to an element
   */
  setFocus(element: HTMLElement): void {
    this.saveFocus();
    element.focus();
    this.currentFocus = element;
  }

  /**
   * Get current focused element
   */
  getCurrentFocus(): HTMLElement | null {
    return this.currentFocus;
  }

  /**
   * Clear focus history
   */
  clearHistory(): void {
    this.focusHistory = [];
    this.currentFocus = null;
  }
}

/**
 * ARIA attribute utilities
 */
export class AriaManager {
  /**
   * Set ARIA attributes safely
   */
  static setAttribute(element: HTMLElement, attribute: string, value: string): void {
    if (element) {
      element.setAttribute(attribute, value);
    }
  }

  /**
   * Remove ARIA attributes safely
   */
  static removeAttribute(element: HTMLElement, attribute: string): void {
    if (element) {
      element.removeAttribute(attribute);
    }
  }

  /**
   * Set ARIA label
   */
  static setLabel(element: HTMLElement, label: string): void {
    this.setAttribute(element, "aria-label", label);
  }

  /**
   * Set ARIA described by
   */
  static setDescribedBy(element: HTMLElement, describedById: string): void {
    this.setAttribute(element, "aria-describedby", describedById);
  }

  /**
   * Set ARIA labelled by
   */
  static setLabelledBy(element: HTMLElement, labelledById: string): void {
    this.setAttribute(element, "aria-labelledby", labelledById);
  }

  /**
   * Set ARIA expanded state
   */
  static setExpanded(element: HTMLElement, expanded: boolean): void {
    this.setAttribute(element, "aria-expanded", expanded.toString());
  }

  /**
   * Set ARIA pressed state
   */
  static setPressed(element: HTMLElement, pressed: boolean): void {
    this.setAttribute(element, "aria-pressed", pressed.toString());
  }

  /**
   * Set ARIA disabled state
   */
  static setDisabled(element: HTMLElement, disabled: boolean): void {
    this.setAttribute(element, "aria-disabled", disabled.toString());
    if (disabled) {
      element.setAttribute("tabindex", "-1");
    } else {
      element.removeAttribute("tabindex");
    }
  }

  /**
   * Set ARIA busy state
   */
  static setBusy(element: HTMLElement, busy: boolean): void {
    this.setAttribute(element, "aria-busy", busy.toString());
  }

  /**
   * Set ARIA live region
   */
  static setLiveRegion(element: HTMLElement, politeness: "off" | "polite" | "assertive"): void {
    this.setAttribute(element, "aria-live", politeness);
  }

  /**
   * Set ARIA atomic
   */
  static setAtomic(element: HTMLElement, atomic: boolean): void {
    this.setAttribute(element, "aria-atomic", atomic.toString());
  }

  /**
   * Set ARIA relevant
   */
  static setRelevant(element: HTMLElement, relevant: string): void {
    this.setAttribute(element, "aria-relevant", relevant);
  }
}

/**
 * Keyboard navigation utilities
 */
export class KeyboardManager {
  private static instance: KeyboardManager;
  private keyHandlers: Map<string, Set<(event: KeyboardEvent) => void>> = new Map();

  static getInstance(): KeyboardManager {
    if (!KeyboardManager.instance) {
      KeyboardManager.instance = new KeyboardManager();
    }
    return KeyboardManager.instance;
  }

  /**
   * Add keyboard event handler
   */
  addHandler(key: string, handler: (event: KeyboardEvent) => void): () => void {
    if (!this.keyHandlers.has(key)) {
      this.keyHandlers.set(key, new Set());
    }
    
    this.keyHandlers.get(key)!.add(handler);

    // Return cleanup function
    return () => {
      const handlers = this.keyHandlers.get(key);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.keyHandlers.delete(key);
        }
      }
    };
  }

  /**
   * Handle keyboard event
   */
  handleEvent(event: KeyboardEvent): void {
    const handlers = this.keyHandlers.get(event.key);
    if (handlers) {
      handlers.forEach(handler => handler(event));
    }
  }

  /**
   * Clear all handlers
   */
  clear(): void {
    this.keyHandlers.clear();
  }
}

/**
 * Accessibility testing utilities
 */
export class AccessibilityTester {
  /**
   * Check if element has proper ARIA attributes
   */
  static checkAriaAttributes(element: HTMLElement): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];
    
    // Check for required attributes based on role
    const role = element.getAttribute("role");
    
    if (role === "button") {
      if (!element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby") && !element.textContent?.trim()) {
        issues.push("Button missing accessible name");
      }
    }
    
    if (role === "link") {
      if (!element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby") && !element.textContent?.trim()) {
        issues.push("Link missing accessible name");
      }
    }
    
    // Check for proper live region attributes
    const live = element.getAttribute("aria-live");
    if (live && !["off", "polite", "assertive"].includes(live)) {
      issues.push(`Invalid aria-live value: ${live}`);
    }
    
    const atomic = element.getAttribute("aria-atomic");
    if (atomic && !["true", "false"].includes(atomic)) {
      issues.push(`Invalid aria-atomic value: ${atomic}`);
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Check focus management
   */
  static checkFocusManagement(): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];
    const activeElement = document.activeElement;
    
    if (activeElement === document.body) {
      issues.push("No element is currently focused");
    }
    
    // Check for focus trap violations
    const focusableElements = document.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    if (focusableElements.length === 0) {
      issues.push("No focusable elements found");
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Check color contrast (simplified)
   */
  static checkColorContrast(element: HTMLElement): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];
    const styles = getComputedStyle(element);
    
    // This is a simplified check - in production, you'd use a proper color contrast library
    const color = styles.color;
    const backgroundColor = styles.backgroundColor;
    
    if (color === "transparent" || backgroundColor === "transparent") {
      issues.push("Transparent colors may have poor contrast");
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}

/**
 * React hook for screen reader announcements
 */
export function useScreenReader() {
  const screenReader = ScreenReaderManager.getInstance();

  const announce = useCallback((
    message: string, 
    priority: "polite" | "assertive" = "polite",
    timeout?: number
  ) => {
    screenReader.announce(message, priority, timeout);
  }, []);

  const announceStatusChange = useCallback((
    fromStatus: string,
    toStatus: string,
    details?: string
  ) => {
    const message = details 
      ? `Network status changed from ${fromStatus} to ${toStatus}. ${details}`
      : `Network status changed from ${fromStatus} to ${toStatus}`;
    
    announce(message, "assertive");
  }, [announce]);

  const announceLatency = useCallback((latency: number) => {
    const message = `Network latency is ${latency} milliseconds`;
    announce(message, "polite");
  }, [announce]);

  const announceConnectionType = useCallback((type: string) => {
    const message = `Connection type is ${type}`;
    announce(message, "polite");
  }, [announce]);

  const announceError = useCallback((error: string) => {
    const message = `Network error: ${error}`;
    announce(message, "assertive");
  }, [announce]);

  const announceQuality = useCallback((quality: string, latency: number) => {
    const message = `Connection quality is ${quality} with ${latency} milliseconds latency`;
    announce(message, "polite");
  }, [announce]);

  return {
    announce,
    announceStatusChange,
    announceLatency,
    announceConnectionType,
    announceError,
    announceQuality,
  };
}

/**
 * React hook for focus management
 */
export function useFocusManagement() {
  const focusManager = FocusManager.getInstance();

  const saveFocus = useCallback(() => {
    focusManager.saveFocus();
  }, []);

  const restoreFocus = useCallback(() => {
    focusManager.restoreFocus();
  }, []);

  const setFocus = useCallback((element: HTMLElement | null) => {
    if (element) {
      focusManager.setFocus(element);
    }
  }, []);

  const getCurrentFocus = useCallback(() => {
    return focusManager.getCurrentFocus();
  }, []);

  return {
    saveFocus,
    restoreFocus,
    setFocus,
    getCurrentFocus,
  };
}

// Import React hooks
import { useCallback } from "react";
