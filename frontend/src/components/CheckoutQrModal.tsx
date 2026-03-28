"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import toast from "react-hot-toast";
import { QRCodeCanvas } from "qrcode.react";
import { Modal } from "@/components/ui/Modal";

interface CheckoutQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  qrValue: string;
  paymentId: string;
}

export default function CheckoutQrModal({
  isOpen,
  onClose,
  qrValue,
  paymentId,
}: CheckoutQrModalProps) {
  const t = useTranslations("checkout");
  const qrWrapperRef = useRef<HTMLDivElement | null>(null);

  const handleDownload = () => {
    const canvas = qrWrapperRef.current?.querySelector("canvas");

    if (!canvas) {
      toast.error(t("downloadQrError"));
      return;
    }

    try {
      const link = document.createElement("a");
      link.download = `stellar-payment-${paymentId}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast.success(t("downloadQrSuccess"));
    } catch {
      toast.error(t("downloadQrError"));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("qrModalTitle")}>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-slate-400">{t("qrModalDescription")}</p>
        <div
          ref={qrWrapperRef}
          className="flex items-center justify-center rounded-2xl border border-white/10 bg-white p-5"
        >
          <QRCodeCanvas value={qrValue} size={260} level="M" includeMargin />
        </div>
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-mint/30 bg-mint/10 px-4 font-semibold text-mint transition-colors hover:bg-mint/15"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v1a2 2 0 002 2h12a2 2 0 002-2v-1"
            />
          </svg>
          {t("downloadQr")}
        </button>
      </div>
    </Modal>
  );
}
