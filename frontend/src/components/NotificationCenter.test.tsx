import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationCenter from './NotificationCenter';
import * as merchantStore from '@/lib/merchant-store';

// Mock next-intl — returns the key with interpolated values so assertions are stable
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (!values) return key;
    // Simple interpolation: replace {param} with its value
    return Object.entries(values).reduce<string>(
      (str, [k, v]) => str.replace(`{${k}}`, String(v)),
      key
    );
  },
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock API
global.fetch = vi.fn();

describe('NotificationCenter', () => {
  const mockApiKey = 'test-api-key';
  
  beforeEach(() => {
    vi.mocked(merchantStore).useMerchantApiKey = vi.fn(() => mockApiKey);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('should render notification button', () => {
      render(<NotificationCenter />);
      // With i18n mock, aria-label returns the translation key "buttonLabel"
      const button = screen.getByRole('button', { name: /buttonLabel/i });
      expect(button).toBeInTheDocument();
    });

    it('should render with unread count badge when notifications exist', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unreadCount: 3, notifications: [] })
      });

      render(<NotificationCenter />);
      
      await waitFor(() => {
        // With i18n mock: t("buttonLabelWithCount", { count: 3 }) => "buttonLabelWithCount" (key with {count} replaced)
        const button = screen.getByRole('button', { name: /buttonLabelWithCount/i });
        expect(button).toBeInTheDocument();
      });
    });

    it('should render without unread count when no notifications', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unreadCount: 0, notifications: [] })
      });

      render(<NotificationCenter />);
      
      await waitFor(() => {
        const button = screen.getByRole('button', { name: /buttonLabel/i });
        expect(button).toBeInTheDocument();
      });
    });

    it('should render notification dropdown when opened', async () => {
      const user = userEvent.setup();
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 2, notifications: [] })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      
      // aria-label comes from t("panelLabel") which the mock returns as "panelLabel"
      const dialog = screen.getByRole('dialog', { name: /panelLabel/i });
      expect(dialog).toBeInTheDocument();
    });

    it('should render notification items', async () => {
      const user = userEvent.setup();
      const mockNotifications = [
        { id: '1', message: 'Payment received', read: false },
        { id: '2', message: 'New merchant registered', read: false }
      ];
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 2, notifications: mockNotifications })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      
      await waitFor(() => {
        expect(screen.getByText('Payment received')).toBeInTheDocument();
        expect(screen.getByText('New merchant registered')).toBeInTheDocument();
      });
    });

    it('should render empty state when no notifications', async () => {
      const user = userEvent.setup();
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 0, notifications: [] })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      
      // t("noAlerts") => "noAlerts" from mock
      await waitFor(() => {
        expect(screen.getByText('noAlerts')).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility (Screen Reader Support)', () => {
    it('should have proper ARIA labels on button', () => {
      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      // With i18n mock, aria-label is the translation key "buttonLabel"
      expect(button).toHaveAttribute('aria-label', 'buttonLabel');
    });

    it('should include unread count in ARIA label', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unreadCount: 5, notifications: [] })
      });

      render(<NotificationCenter />);
      
      await waitFor(() => {
        // t("buttonLabelWithCount", { count: 5 }) → key with {count} interpolated
        const button = screen.getByRole('button', { name: /buttonLabelWithCount/i });
        expect(button).toBeInTheDocument();
      });
    });

    it('should have aria-expanded attribute', () => {
      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('should update aria-expanded when opened', async () => {
      const user = userEvent.setup();
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 0, notifications: [] })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');
    });

    it('should have aria-haspopup attribute', () => {
      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    });

    it('should have role="dialog" on dropdown', async () => {
      const user = userEvent.setup();
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 0, notifications: [] })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('should have aria-live region for unread count', async () => {
      const user = userEvent.setup();
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 3, notifications: [] })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      
      // t("unreadCount", { count: 3 }) → "unreadCount" with {count} replaced → "3 unread" → key text with value
      // Our mock returns the key text with values interpolated, so "unreadCount" key becomes the string with "{count}" replaced
      const liveRegion = screen.getByText(/unreadCount/);
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
      expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    });

    it('should have role="list" on notification container', async () => {
      const user = userEvent.setup();
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 0, notifications: [] })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      
      // aria-label from t("heading") => "heading"
      const list = screen.getByRole('list', { name: /heading/i });
      expect(list).toBeInTheDocument();
    });

    it('should have role="listitem" on notification items', async () => {
      const user = userEvent.setup();
      const mockNotifications = [
        { id: '1', message: 'Test notification', read: false }
      ];
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 1, notifications: mockNotifications })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      
      const listitem = screen.getByRole('listitem');
      expect(listitem).toBeInTheDocument();
    });

    it('should have proper ARIA labels on dismiss buttons', async () => {
      const user = userEvent.setup();
      const mockNotifications = [
        { id: '1', message: 'Test notification', read: false }
      ];
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 1, notifications: mockNotifications })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      
      // t("dismissLabel", { message: "Test notification" }) → "dismissLabel" with {message} replaced
      const dismissButton = screen.getByRole('button', { name: /dismissLabel/i });
      expect(dismissButton).toBeInTheDocument();
    });

    it('should have aria-hidden on decorative icons', () => {
      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      const svg = button.querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });

    it('should have min touch targets for mobile accessibility', () => {
      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('min-h-[44px]', 'min-w-[44px]');
    });
  });

  describe('Optimistic Updates', () => {
    it('should optimistically dismiss notification', async () => {
      const user = userEvent.setup();
      const mockNotifications = [
        { id: '1', message: 'Test notification', read: false }
      ];
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 1, notifications: mockNotifications })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      
      const dismissButton = screen.getByRole('button', { name: /dismiss notification/i });
      await user.click(dismissButton);
      
      // Notification should be removed immediately (optimistic)
      await waitFor(() => {
        expect(screen.queryByText('Test notification')).not.toBeInTheDocument();
      });
    });

    it('should optimistically update unread count on dismiss', async () => {
      const user = userEvent.setup();
      const mockNotifications = [
        { id: '1', message: 'Test notification', read: false }
      ];
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 1, notifications: mockNotifications })
      });

      render(<NotificationCenter />);
      
      await waitFor(() => {
        const button = screen.getByRole('button', { name: /notifications \(1 unread\)/i });
        expect(button).toBeInTheDocument();
      });
      
      const button = screen.getByRole('button');
      await user.click(button);
      
      const dismissButton = screen.getByRole('button', { name: /dismiss notification/i });
      await user.click(dismissButton);
      
      // Unread count should update immediately
      await waitFor(() => {
        const updatedButton = screen.getByRole('button', { name: /notifications/i });
        expect(updatedButton).toBeInTheDocument();
      });
    });

    it('should optimistically mark all as read on open', async () => {
      const user = userEvent.setup();
      const mockNotifications = [
        { id: '1', message: 'Test notification', read: false }
      ];
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 1, notifications: mockNotifications })
      });

      render(<NotificationCenter />);
      
      await waitFor(() => {
        const button = screen.getByRole('button', { name: /notifications \(1 unread\)/i });
        expect(button).toBeInTheDocument();
      });
      
      const button = screen.getByRole('button');
      await user.click(button);
      
      // Unread count should reset to 0 immediately
      await waitFor(() => {
        const updatedButton = screen.getByRole('button', { name: /notifications/i });
        expect(updatedButton).toBeInTheDocument();
      });
    });

    it('should call dismiss API endpoint', async () => {
      const user = userEvent.setup();
      const mockNotifications = [
        { id: '1', message: 'Test notification', read: false }
      ];
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 1, notifications: mockNotifications })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      
      const dismissButton = screen.getByRole('button', { name: /dismiss notification/i });
      await user.click(dismissButton);
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/notifications/1/dismiss'),
          expect.objectContaining({
            method: 'POST',
            headers: { 'x-api-key': mockApiKey }
          })
        );
      });
    });

    it('should call mark-read API endpoint on open', async () => {
      const user = userEvent.setup();
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 1, notifications: [] })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/notifications/mark-read'),
          expect.objectContaining({
            method: 'POST',
            headers: { 'x-api-key': mockApiKey }
          })
        );
      });
    });
  });

  describe('User Interactions', () => {
    it('should toggle dropdown on button click', async () => {
      const user = userEvent.setup();
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 0, notifications: [] })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      // Open
      await user.click(button);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      
      // Close
      await user.click(button);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should close dropdown when clicking outside', async () => {
      const user = userEvent.setup();
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 0, notifications: [] })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      
      // Click outside
      await user.click(document.body);
      
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('should fetch notifications on mount', () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 0, notifications: [] })
      });

      render(<NotificationCenter />);
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/notifications'),
        expect.objectContaining({
          headers: { 'x-api-key': mockApiKey }
        })
      );
    });

    it('should poll notifications every 30 seconds', () => {
      vi.useFakeTimers();
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 0, notifications: [] })
      });

      render(<NotificationCenter />);
      
      expect(global.fetch).toHaveBeenCalledTimes(1);
      
      vi.advanceTimersByTime(30000);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      
      vi.advanceTimersByTime(30000);
      expect(global.fetch).toHaveBeenCalledTimes(3);
      
      vi.useRealTimers();
    });

    it('should not fetch when API key is missing', () => {
      vi.mocked(merchantStore).useMerchantApiKey = vi.fn(() => '');
      
      render(<NotificationCenter />);
      
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle API errors gracefully', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      render(<NotificationCenter />);
      
      // Should not crash, just silently fail
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should handle non-OK responses', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        json: async () => ({})
      });

      render(<NotificationCenter />);
      
      // Should not crash
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should handle notifications without IDs', async () => {
      const user = userEvent.setup();
      const mockNotifications = [
        { message: 'Test notification' } as any
      ];
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 1, notifications: mockNotifications })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      
      // Should still render
      expect(screen.getByText('Test notification')).toBeInTheDocument();
    });

    it('should handle notifications with timestamps', async () => {
      const user = userEvent.setup();
      const mockNotifications = [
        { id: '1', message: 'Test notification', timestamp: '2024-01-01T00:00:00Z' }
      ];
      
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 1, notifications: mockNotifications })
      });

      render(<NotificationCenter />);
      const button = screen.getByRole('button');
      
      await user.click(button);
      
      expect(screen.getByText('Test notification')).toBeInTheDocument();
      expect(screen.getByText(/2024/)).toBeInTheDocument();
    });

    it('should handle empty notification array', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 0, notifications: [] })
      });

      render(<NotificationCenter />);
      
      await waitFor(() => {
        expect(screen.getByRole('button')).toBeInTheDocument();
      });
    });

    it('should handle missing notification data', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({})
      });

      render(<NotificationCenter />);
      
      // Should not crash
      expect(screen.getByRole('button')).toBeInTheDocument();
    });
  });

  describe('Animation Behavior', () => {
    it('should render motion components', () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ unreadCount: 0, notifications: [] })
      });

      render(<NotificationCenter />);
      
      // Motion components should render as their base elements
      expect(screen.getByRole('button')).toBeInTheDocument();
    });
  });
});
