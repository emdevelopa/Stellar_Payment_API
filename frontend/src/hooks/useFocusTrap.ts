/**
 * useFocusTrap hook
 *
 * WCAG 2.1 AA compliant focus trap for modal dialogs and panels.
 * Implements focus management per WCAG 2.4.3 (Focus Order) and 2.1.2 (No Keyboard Trap).
 *
 * #1497 - Implement WCAG 2.1 AA accessible focus trap
 */

import { useEffect, useRef, useCallback } from "react";

interface UseFocusTrapOptions {
  /**
   * Whether the trap is active. When false, focus management is disabled.
   */
  enabled: boolean;
  /**
   * Callback invoked when Escape key is pressed.
   */
  onEscape?: () => void;
  /**
   * Whether to return focus to the element that had it when the trap was
   * enabled, once the trap is disabled or the component unmounts.
   * Defaults to true (WCAG 2.4.3 Focus Order).
   */
  returnFocusOnDeactivate?: boolean;
  /**
   * Move focus to the container itself, instead of its first focusable
   * element, when the trap is enabled. The container needs `tabIndex={-1}`.
   * Use this for dialogs so a screen reader announces the dialog's name and
   * description before any control (#1839). Defaults to false.
   */
  focusContainerOnActivate?: boolean;
}

/**
 * Selector for all focusable elements per WCAG guidelines.
 * Includes standard interactive elements and any element with tabindex >= 0.
 */
const FOCUSABLE_ELEMENTS = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable]',
  '[tabindex]:not([tabindex^="-"])',
].join(',');

/**
 * Custom hook for implementing WCAG 2.1 AA compliant focus trap.
 *
 * @param options Configuration options
 * @returns Ref to attach to the container element
 *
 * @example
 * ```tsx
 * function Dialog({ isOpen, onClose }) {
 *   const trapRef = useFocusTrap({
 *     enabled: isOpen,
 *     onEscape: onClose,
 *   });
 *
 *   if (!isOpen) return null;
 *
 *   return (
 *     <div ref={trapRef} role="dialog" aria-modal="true">
 *       {content}
 *     </div>
 *   );
 * }
 * ```
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  options: UseFocusTrapOptions
) {
  const {
    enabled,
    onEscape,
    returnFocusOnDeactivate = true,
    focusContainerOnActivate = false,
  } = options;
  const containerRef = useRef<T>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  /**
   * Get all focusable elements within the container.
   */
  const getFocusableElements = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return [];

    const elements = containerRef.current.querySelectorAll<HTMLElement>(
      FOCUSABLE_ELEMENTS
    );

    return Array.from(elements).filter(
      (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
    );
  }, []);

  /**
   * Handle Tab key navigation to create the focus trap.
   */
  const handleTabKey = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || event.key !== 'Tab') return;

      const container = containerRef.current;
      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        // Nothing to tab to: keep focus on the container rather than let it leave.
        event.preventDefault();
        container?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const active = document.activeElement;

      // Focus is on the container itself (it has tabindex="-1"), or has somehow left
      // it: Shift+Tab goes to the last control, Tab to the first, so focus can never
      // escape to the page behind a modal.
      if (!active || active === container || !container?.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
        return;
      }

      // Shift + Tab on first element -> focus last
      if (event.shiftKey && active === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      // Tab on last element -> focus first
      if (!event.shiftKey && active === lastElement) {
        event.preventDefault();
        firstElement.focus();
        return;
      }
    },
    [enabled, getFocusableElements]
  );

  /**
   * Handle Escape key to close the trap.
   */
  const handleEscapeKey = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || event.key !== 'Escape') return;

      event.preventDefault();
      onEscape?.();
    },
    [enabled, onEscape]
  );

  /**
   * Activate the trap: remember where focus was, move it into the container, and give
   * it back when the trap is disabled or the component unmounts.
   *
   * Restoring in this effect's cleanup (keyed on `enabled`) matters for components that
   * stay mounted while closed, such as a dialog that returns `null` when `isOpen` is
   * false. Restoring only on unmount would leave focus lost after the dialog closes.
   */
  useEffect(() => {
    if (!enabled) return;

    // Store the currently focused element to return focus later
    previousActiveElement.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Small delay to ensure the container is rendered and positioned
    const timer = setTimeout(() => {
      if (focusContainerOnActivate) {
        containerRef.current?.focus();
        return;
      }
      getFocusableElements()[0]?.focus();
    }, 10);

    return () => {
      clearTimeout(timer);
      if (returnFocusOnDeactivate) {
        previousActiveElement.current?.focus();
      }
      previousActiveElement.current = null;
    };
  }, [enabled, focusContainerOnActivate, returnFocusOnDeactivate, getFocusableElements]);

  /**
   * Set up keyboard event listeners.
   */
  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleTabKey);
    document.addEventListener('keydown', handleEscapeKey);

    return () => {
      document.removeEventListener('keydown', handleTabKey);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [enabled, handleTabKey, handleEscapeKey]);

  return containerRef;
}
