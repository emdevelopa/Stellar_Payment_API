"use client";

import { useEffect, useState } from "react";
import { useMerchantApiKey } from "@/lib/merchant-store";
import { BellIcon } from "@heroicons/react/24/outline";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface Notification {
  message: string;
}

export default function NotificationCenter() {
  const apiKey = useMerchantApiKey();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
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
      } catch {
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
        className="relative flex items-center justify-center p-2.5 rounded-lg border border-[#E8E8E8] bg-white text-[#6B6B6B] hover:text-[#0A0A0A] hover:bg-[#F5F5F5] transition-all"
      >
        <BellIcon className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute top-2 right-2 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00F5D4] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00F5D4] border border-black shadow-[0_0_8px_#00F5D4]"></span>
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-4 w-80 max-h-[32rem] overflow-y-auto rounded-lg border border-[#E8E8E8] bg-white shadow-xl z-50 p-6">
          <h3 className="text-[10px] font-bold text-[#0A0A0A] mb-6 uppercase tracking-widest">Notifications</h3>
          {notifications.length === 0 ? (
            <p className="text-[11px] font-black text-[#A0A0A0] uppercase tracking-widest text-center py-8">No new alerts</p>
          ) : (
            <div className="flex flex-col gap-3">
              {notifications.map((notif, i) => (
                <div key={i} className="rounded-lg bg-[#F9F9F9] border border-[#E8E8E8] p-4 transition-colors hover:bg-[#F0F0F0]">
                  <p className="text-[10px] font-bold text-[#0A0A0A] uppercase tracking-widest mb-1">Alert</p>
                  <p className="text-xs font-medium text-[#6B6B6B] leading-relaxed">{notif.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
