"use client";

import { useCallback } from "react";
import toast from "react-hot-toast";
import {
  usePaymentSocket,
  ConfirmedPaymentEvent,
} from "@/lib/usePaymentSocket";
import { useMerchantId } from "@/lib/merchant-store";

/**
 * Headless component that listens for real-time `payment:confirmed` WebSocket
 * events and surfaces them as success toasts.
 *
 * Mount once inside the authenticated layout so every dashboard page benefits.
 * Renders nothing — it only produces side-effects (toasts).
 */
export default function PaymentToastListener() {
  const merchantId = useMerchantId();

  const handleConfirmed = useCallback((payment: ConfirmedPaymentEvent) => {
    const amount = Number(payment.amount);
    const display = Number.isFinite(amount) ? amount : payment.amount;
    const asset =
      payment.asset === "native" ? "XLM" : payment.asset ?? "USDC";

    toast.success(`Payment of ${display} ${asset} confirmed!`);
  }, []);

  usePaymentSocket(merchantId, handleConfirmed);

  return null;
}
