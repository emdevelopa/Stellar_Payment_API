"use client";

import { useEffect, useState } from "react";
import { useMerchantApiKey } from "@/lib/merchant-store";
import { BellIcon } from "@heroicons/react/24/outline";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function NotificationCenter() {
  const apiKey = useMerchantApiKey();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!apiKey) return;
    const fetchNotifications = async () => {
      try {
        const res = await fetch(`${API_URL}/api/notifications`, {
          headers: { "x-api-key": apiKey }
        });
        if (!res.ok) return;
        const data = await res.json();
        setUnreadCount(data.unreadCount || 0);
        setNotifications(data.notifications || []);
      } catch (err) {
        // silently fail
      }
    };
    fetchNotifications();
    
    // Poll every 30s
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [apiKey]);

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex items-center justify-center p-2 rounded-lg text-slate-300 hover:bg-white/10 transition-colors"
      >
        <BellIcon className="h-6 w-6" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 border border-black"></span>
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-black/90 shadow-2xl backdrop-blur z-50 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Notifications</h3>
          {notifications.length === 0 ? (
            <p className="text-xs text-slate-400">You have no new notifications.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {notifications.map((notif, i) => (
                <div key={i} className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm">
                  <p className="font-medium text-red-400">Delivery Failing</p>
                  <p className="text-xs text-slate-300 mt-1">{notif.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
