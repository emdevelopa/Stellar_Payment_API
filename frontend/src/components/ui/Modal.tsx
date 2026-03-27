import React, { useEffect } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        data-testid="modal-backdrop"
      />
      
      {/* Modals are generally center or sliding sheet in this app. Let's make a center modal for the VRT component itself. */}
      {/* However, the PaymentDetail was a right sliding sheet. We'll build a standard modal dialog. */}
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl transition-all" data-testid="modal-content">
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-mint">{title}</p>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            data-testid="modal-close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="text-white">
          {children}
        </div>
      </div>
    </>
  );
};
