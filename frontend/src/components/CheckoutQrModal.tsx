"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
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
        <p className="text-sm text-[#6B6B6B]">{t("qrModalDescription")}</p>
        <div
          ref={qrWrapperRef}
          className="flex items-center justify-center rounded-2xl border border-[#E8E8E8] bg-white p-5 transition-all hover:border-[var(--pluto-400)] hover:shadow-lg hover:shadow-[var(--pluto-400)]/10"
        >
          <QRCodeCanvas
            value={qrValue}
            size={512}
            level="H"
            includeMargin
            style={{ width: "100%", height: "auto", maxWidth: "240px" }}
          />
        </div>
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--pluto-200)] bg-[var(--pluto-50)] px-4 font-bold uppercase tracking-widest text-xs text-[var(--pluto-700)] transition-all hover:bg-[var(--pluto-100)] hover:border-[var(--pluto-400)] hover:shadow-md hover:shadow-[var(--pluto-500)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
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
