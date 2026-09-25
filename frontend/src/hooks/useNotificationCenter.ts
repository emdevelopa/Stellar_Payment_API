import { useCallback, useEffect, useState } from "react";
import { useMerchantApiKey } from "@/lib/merchant-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface Notification {
  id: string;
  message: string;
  read?: boolean;
  timestamp?: string;
}

export function useNotificationCenter() {
  const apiKey = useMerchantApiKey();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!apiKey) return;
    try {
      const res = await fetch(`${API_URL}/api/notifications`, {
        headers: { "x-api-key": apiKey },
      });
      if (!res.ok) return;
      const data = await res.json();
      setUnreadCount(data.unreadCount || 0);
      setNotifications(data.notifications || []);
    } catch {
      // silently fail
    }
  }, [apiKey]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const handleMarkAsRead = useCallback(() => {
    if (unreadCount === 0) return;
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    fetch(`${API_URL}/api/notifications/mark-read`, {
      method: "POST",
      headers: { "x-api-key": apiKey ?? "" },
    }).catch(() => fetchNotifications());
  }, [unreadCount, apiKey, fetchNotifications]);

  const handleDismiss = useCallback(
    (id: string) => {
      // Optimistic update
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setUnreadCount((prev) => Math.max(0, prev - 1));

      fetch(`${API_URL}/api/notifications/${id}/dismiss`, {
        method: "POST",
        headers: { "x-api-key": apiKey ?? "" },
      }).catch(() => fetchNotifications());
    },
    [apiKey, fetchNotifications]
  );

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next && unreadCount > 0) handleMarkAsRead();
      return next;
    });
  }, [unreadCount, handleMarkAsRead]);

  return {
    notifications,
    unreadCount,
    isOpen,
    toggleOpen,
    handleDismiss,
  };
}
