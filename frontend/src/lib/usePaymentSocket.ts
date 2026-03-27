"use client";

import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

export interface ConfirmedPaymentEvent {
  id: string;
  amount: number;
  asset: string;
  asset_issuer: string | null;
  recipient: string;
  tx_id: string;
  confirmed_at: string;
}

type Handler = (payment: ConfirmedPaymentEvent) => void;

/**
 * Connects to the backend Socket.io server and joins the merchant's private
 * room so the component receives `payment:confirmed` events in real time.
 *
 * @param merchantId  The authenticated merchant's UUID
 * @param onConfirmed Callback invoked for every confirmed payment event
 */
export function usePaymentSocket(
  merchantId: string | null | undefined,
  onConfirmed: Handler,
) {
  const socketRef = useRef<Socket | null>(null);
  // Keep a stable ref to the handler so the effect doesn't re-run on every render
  const handlerRef = useRef<Handler>(onConfirmed);
  handlerRef.current = onConfirmed;

  useEffect(() => {
    if (!merchantId) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

    const socket = io(apiUrl, {
      transports: ["websocket"],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      // Join the merchant's private room — the backend emits only to this room
      socket.emit("join:merchant", { merchant_id: merchantId });
    });

    socket.on("payment:confirmed", (payload: ConfirmedPaymentEvent) => {
      handlerRef.current(payload);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [merchantId]);
}
