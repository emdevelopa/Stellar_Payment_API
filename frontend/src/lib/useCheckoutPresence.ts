"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

interface CheckoutPresenceEvent {
  payment_id: string;
  active_viewers: number;
}

export function useCheckoutPresence(paymentId: string | null | undefined) {
  const [activeViewers, setActiveViewers] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!paymentId) {
      setActiveViewers(0);
      return;
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    const socket = io(apiUrl, {
      transports: ["websocket"],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join:checkout", { payment_id: paymentId });
    });

    socket.on("checkout:presence", (payload: CheckoutPresenceEvent) => {
      if (payload.payment_id === paymentId) {
        setActiveViewers(payload.active_viewers);
      }
    });

    return () => {
      socket.emit("leave:checkout", { payment_id: paymentId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [paymentId]);

  return activeViewers;
}
