/**
 * Multi-Signature Approval Modal Component
 * Issue #1143: Upgrade dependencies and refactor Multi-sig Approval Modal
 *
 * UX enhancements:
 * - Improved accessibility with ARIA attributes
 * - Enhanced motion and animations with reduced-motion support
 * - Better focus management and keyboard navigation
 * - Responsive design for mobile and desktop
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion, type Variants } from "framer-motion";
import { useTranslations } from "next-intl";
import { useMultisigState, useMultisigActions } from "@/lib/multisig-context";
import { toast } from "sonner";
import CopyButton from "@/components/CopyButton";
import { errorMessageVariants } from "@/lib/network-animations";

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 0.3 } },
};

const modalVariants: Variants = {
  hidden: { scale: 0.85, opacity: 0, y: 30 },
  visible: {
    scale: 1,
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.32, 0.72, 0.0, 1.0] as [number, number, number, number],
      type: "spring" as const,
      stiffness: 300,
      damping: 30,
    },
  },
  exit: {
    scale: 0.85,
    opacity: 0,
    y: 30,
    transition: { duration: 0.2, ease: [0.32, 0.72, 0.0, 1.0] as [number, number, number, number] },
  },
};

const stepVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2 } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.15 } },
};

const signerListVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const signerItemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.2 } },
};

interface MultisigApprovalModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly networkPassphrase: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly transaction?: any;
}

export default function MultisigApprovalModal({
  isOpen,
  onClose,
  networkPassphrase: _networkPassphrase,
  transaction: initialTransaction,
}: MultisigApprovalModalProps) {
  const t = useTranslations("multisigModal");
  const prefersReducedMotion = useReducedMotion();
  const modalRef = useRef<HTMLDivElement>(null);
  const [signingSignerId, setSigningSignerId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    transaction,
    currentStep,
    isLoading,
    error,
    canSign,
    canSubmit,
    signedCount,
    requiredSignatures,
    progress,
    isExpired,
    isPendingConfirmation,
    timeRemaining,
  } = useMultisigState();

  const {
    setTransaction,
    setCurrentStep: _setCurrentStep,
    signTransaction,
    submitTransaction,
    resetModal,
    clearError,
    retryAction,
  } = useMultisigActions();

  // Set transaction when modal opens
  useEffect(() => {
    if (isOpen && initialTransaction && !transaction) {
      setTransaction(initialTransaction);
    }
  }, [isOpen, initialTransaction, transaction, setTransaction]);

  // Handle escape key, focus trap, and focus return
  useEffect(() => {
    if (!isOpen) return;

    const triggerElement = document.activeElement as HTMLElement | null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!isLoading && !isPendingConfirmation) {
          handleClose();
        }
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusable = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");

        if (focusable.length === 0) return;

        const closeBtn = modalRef.current.querySelector<HTMLElement>('button[aria-label="Close modal"]') || focusable[0];
        const signButtons = Array.from(modalRef.current.querySelectorAll<HTMLElement>('button')).filter(
          (b) => b.textContent?.trim() === "Sign" || b.textContent?.trim() === "Signed"
        );
        const firstSignBtn = signButtons[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstSignBtn && closeBtn) {
            e.preventDefault();
            closeBtn.focus();
          } else if (document.activeElement === closeBtn) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === closeBtn && firstSignBtn) {
            e.preventDefault();
            firstSignBtn.focus();
          } else if (document.activeElement === last) {
            e.preventDefault();
            closeBtn.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    modalRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerElement?.focus();
    };
  }, [isOpen, isLoading, isPendingConfirmation]);

  // Body scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  const handleClose = useCallback(() => {
    if (isLoading || isPendingConfirmation) return;
    resetModal();
    onClose();
  }, [isLoading, isPendingConfirmation, resetModal, onClose]);

  const handleSign = useCallback(async (signerId: string) => {
    setSigningSignerId(signerId);
    try {
      await signTransaction(signerId);
      toast.success(t("toasts.signed"));
    } catch (err) {
      console.error("Signing failed:", err);
    } finally {
      setSigningSignerId(null);
    }
  }, [signTransaction, t]);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await submitTransaction();
      toast.success(t("toasts.submitted"));
    } catch (err) {
      console.error("Submission failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [submitTransaction, t]);

  const handleRetry = useCallback(() => {
    retryAction();
  }, [retryAction]);

  // Step render functions with improved accessibility and typography
  const renderReviewStep = () => (
    <div className="space-y-4 sm:space-y-5" role="region" aria-label={t("review.sectionAriaLabel")}>
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-mint/10 mb-3">
          <svg className="w-6 h-6 text-mint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <h3 className="text-base sm:text-lg font-bold text-white tracking-tight" id="review-title">{t("review.heading")}</h3>
        <p className="mt-1 text-xs sm:text-sm text-slate-400 leading-relaxed max-w-sm mx-auto" id="review-description">
          {t("review.description")}
        </p>
      </div>

      {transaction && (
        <div className="space-y-4">
          {/* Transaction Details */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 sm:p-4 space-y-2.5 sm:space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("review.amount")}</span>
              <span className="font-mono text-sm font-semibold text-white">
                {transaction.amount} {transaction.assetCode}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("review.to")}</span>
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-sm text-slate-200 truncate max-w-[140px] xs:max-w-[180px] sm:max-w-[240px]">
                  {transaction.destination}
                </span>
                <CopyButton text={transaction.destination} />
              </div>
            </div>
            {transaction.assetIssuer && (
              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("review.issuer") || "Issuer"}</span>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-sm text-slate-200 truncate max-w-[140px] xs:max-w-[180px] sm:max-w-[240px]">
                    {transaction.assetIssuer}
                  </span>
                  <CopyButton text={transaction.assetIssuer} />
                </div>
              </div>
            )}
            {transaction.memo && (
              <div className="flex justify-between items-center py-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("review.memo")}</span>
                <span className="font-mono text-sm text-slate-200 truncate max-w-[160px] xs:max-w-[200px]">{transaction.memo}</span>
              </div>
            )}
          </div>

          {/* Signature Progress */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t("review.signaturesLabel", { signed: signedCount, required: requiredSignatures })}
              </span>
              <span className="font-mono text-xs font-bold text-mint">{Math.round(progress)}%</span>
            </div>
            <motion.div 
              className="w-full bg-white/10 rounded-full h-2 overflow-hidden"
              role="progressbar"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("review.progressAriaLabel")}
            >
              <motion.div 
                className="bg-mint h-2 rounded-full"
                layout
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              />
            </motion.div>
          </div>

          {/* Signers List */}
          <div className="space-y-2" role="region" aria-label={t("review.signersListAriaLabel")}>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400" id="signers-label">{t("review.signersLabel")}</span>
            <motion.ul
              className="space-y-2"
              aria-labelledby="signers-label"
              variants={!prefersReducedMotion ? signerListVariants : undefined}
              initial="hidden"
              animate="visible"
            >
              {transaction.signers.map((signer) => {
                const isThisSigning = signingSignerId === signer.id;
                const isAnySigning = Boolean(signingSignerId);
                return (
                  <motion.li
                    key={signer.id}
                    variants={!prefersReducedMotion ? signerItemVariants : undefined}
                    className={`flex items-center justify-between gap-3 rounded-lg border p-3 transition-all duration-200 ${
                      signer.hasSigned
                        ? "border-mint/30 bg-mint/5 shadow-sm shadow-mint/5"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                    }`}
                    role="listitem"
                    aria-label={t("review.signerAriaLabel", {
                      name: signer.name || t("review.signerFallbackName", { id: signer.id.slice(0, 8) }),
                      weight: signer.weight,
                      status: signer.hasSigned ? t("review.signedStatus") : t("review.notSignedStatus"),
                    })}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          signer.hasSigned ? "bg-mint" : "bg-slate-500"
                        }`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white truncate">
                          {signer.name || t("review.signerFallbackName", { id: signer.id.slice(0, 8) })}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {t("review.signerWeight", { weight: signer.weight, publicKey: signer.publicKey.slice(0, 8) })}
                        </p>
                      </div>
                    </div>
                    <motion.button
                      onClick={() => handleSign(signer.id)}
                      disabled={!canSign || signer.hasSigned || isThisSigning}
                      whileHover={!prefersReducedMotion && canSign && !signer.hasSigned && !isThisSigning ? { scale: 1.02 } : undefined}
                      whileTap={!prefersReducedMotion && canSign && !signer.hasSigned && !isThisSigning ? { scale: 0.98 } : undefined}
                      className={`px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-medium transition-colors shrink-0 ${
                        signer.hasSigned && !isThisSigning
                          ? "bg-mint/10 text-mint cursor-not-allowed"
                          : isThisSigning
                          ? "bg-white/10 text-slate-400 cursor-not-allowed"
                          : canSign
                          ? "bg-mint text-black hover:bg-glow"
                          : "bg-white/10 text-slate-400 cursor-not-allowed"
                      }`}
                      aria-label={t("review.signButtonAriaLabel", {
                        action: signer.hasSigned && !isThisSigning ? t("review.signedStatus") : t("review.signButton"),
                        name: signer.name || t("review.signerFallbackName", { id: signer.id.slice(0, 8) }),
                      })}
                      aria-pressed={signer.hasSigned && !isThisSigning}
                    >
                      {isThisSigning
                        ? t("review.signingButton")
                        : signer.hasSigned
                        ? t("review.signedStatus")
                        : (isLoading && !isAnySigning)
                        ? t("review.signingButton")
                        : t("review.signButton")}
                    </motion.button>
                  </motion.li>
                );
              })}
            </motion.ul>
          </div>

          {/* Time Remaining */}
          {timeRemaining && (
            <div className="flex items-center gap-2 text-xs text-amber-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{t("review.expiresIn", { time: timeRemaining })}</span>
            </div>
          )}

          {/* Submit Button */}
          {canSubmit && (
            <motion.button
              onClick={handleSubmit}
              disabled={isSubmitting}
              whileHover={!prefersReducedMotion && !isSubmitting ? { scale: 1.02 } : undefined}
              whileTap={!prefersReducedMotion && !isSubmitting ? { scale: 0.98 } : undefined}
              className="w-full py-3 min-h-[44px] bg-mint text-black font-semibold rounded-xl hover:bg-glow transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? t("review.submittingButton") : t("review.submitButton")}
            </motion.button>
          )}
        </div>
      )}
    </div>
  );

  const renderProcessingStep = () => (
    <div className="flex flex-col items-center justify-center py-10 text-center" role="status">
      <div className="relative mb-5" aria-hidden="true">
        <div className="w-14 h-14 border-[3px] border-mint border-t-transparent rounded-full animate-spin" />
        <div className="absolute inset-0 w-14 h-14 border-[3px] border-mint/20 rounded-full animate-ping" />
      </div>
      <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">{t("processing.heading")}</h3>
      <p className="mt-1.5 text-xs sm:text-sm text-slate-400 max-w-xs">
        {t("processing.description")}
      </p>
    </div>
  );

  const renderConfirmStep = () => (
    <div className="text-center space-y-4 sm:space-y-5">
      {isPendingConfirmation ? (
        <>
          <div className="relative mx-auto w-14 h-14" aria-hidden="true">
            <div className="w-14 h-14 border-[3px] border-mint border-t-transparent rounded-full animate-spin" />
            <div className="absolute inset-0 w-14 h-14 border-[3px] border-mint/20 rounded-full animate-ping" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">{t("confirm.pendingHeading")}</h3>
            <p className="mt-1.5 text-xs sm:text-sm text-slate-400">
              {t("confirm.pendingDescription")}
            </p>
            <span className="sr-only">{t("processing.heading")}</span>
          </div>
          {transaction?.submittedTxHash && (
            <div className="rounded-xl border border-mint/30 bg-mint/5 p-3.5 sm:p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-mint mb-2">
                {t("confirm.hashPendingLabel")}
              </p>
              <div className="flex items-center justify-center gap-2">
                <code className="font-mono text-sm text-slate-200 truncate max-w-[200px] sm:max-w-[280px]">
                  {transaction.submittedTxHash}
                </code>
                <CopyButton text={transaction.submittedTxHash} />
              </div>
            </div>
          )}
          <motion.button
            disabled
            className="px-6 py-2.5 min-h-[44px] bg-mint/50 text-black/50 font-semibold rounded-xl cursor-not-allowed"
          >
            {t("confirm.confirmingButton")}
          </motion.button>
        </>
      ) : (
        <>
          <div className="w-14 h-14 bg-mint/15 rounded-full flex items-center justify-center mx-auto ring-4 ring-mint/10">
            <svg className="w-7 h-7 text-mint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">{t("confirm.approvedHeading")}</h3>
            <p className="mt-1.5 text-xs sm:text-sm text-slate-400">
              {t("confirm.approvedDescription")}
            </p>
          </div>
          {transaction?.submittedTxHash && (
            <div className="rounded-xl border border-mint/30 bg-mint/5 p-3.5 sm:p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-mint mb-2">{t("confirm.hashLabel")}</p>
              <div className="flex items-center justify-center gap-2">
                <code className="font-mono text-sm text-slate-200 truncate max-w-[200px] sm:max-w-[280px]">
                  {transaction.submittedTxHash}
                </code>
                <CopyButton text={transaction.submittedTxHash} />
              </div>
            </div>
          )}
          <motion.button
            onClick={handleClose}
            whileHover={!prefersReducedMotion ? { scale: 1.02 } : undefined}
            whileTap={!prefersReducedMotion ? { scale: 0.98 } : undefined}
            className="px-6 py-2.5 min-h-[44px] bg-mint text-black font-semibold rounded-xl hover:bg-glow transition-colors"
          >
            {t("confirm.closeButton")}
          </motion.button>
        </>
      )}
    </div>
  );

  const renderErrorStep = () => (
    <div className="text-center space-y-4 sm:space-y-5" role="alert">
      <div className="w-14 h-14 bg-red-500/15 rounded-full flex items-center justify-center mx-auto ring-4 ring-red-500/10">
        <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <div>
        <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">{t("error.heading")}</h3>
        <p className="mt-1.5 text-xs sm:text-sm text-slate-400 max-w-xs mx-auto">
          {error || t("error.defaultMessage")}
        </p>
      </div>
      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 justify-center">
        <motion.button
          onClick={handleRetry}
          whileHover={!prefersReducedMotion ? { scale: 1.02 } : undefined}
          whileTap={!prefersReducedMotion ? { scale: 0.98 } : undefined}
          className="px-6 py-2.5 min-h-[44px] bg-white/10 text-white font-semibold rounded-xl hover:bg-white/20 transition-colors"
        >
          {t("error.tryAgainButton")}
        </motion.button>
        <motion.button
          onClick={handleClose}
          whileHover={!prefersReducedMotion ? { scale: 1.02 } : undefined}
          whileTap={!prefersReducedMotion ? { scale: 0.98 } : undefined}
          className="px-6 py-2.5 min-h-[44px] bg-slate-600 text-white font-semibold rounded-xl hover:bg-slate-500 transition-colors"
        >
          {t("error.closeButton")}
        </motion.button>
      </div>
    </div>
  );

  const renderStep = () => {
    switch (currentStep) {
      case "review":
        return renderReviewStep();
      case "processing":
        return renderProcessingStep();
      case "confirm":
        return renderConfirmStep();
      case "error":
        return renderErrorStep();
      default:
        return renderReviewStep();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 md:p-6">
          {/* Backdrop */}
          <motion.div
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={handleClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            aria-hidden="true"
          />

          {/* Modal */}
          <motion.div
            ref={modalRef}
            variants={!prefersReducedMotion ? modalVariants : undefined}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="relative w-full max-w-lg overflow-hidden rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#050608] shadow-2xl backdrop-blur-xl outline-none max-h-[90vh] sm:max-h-[85vh] flex flex-col"
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-busy={isLoading || isSubmitting}
            aria-labelledby="multisig-modal-title"
            aria-describedby="multisig-modal-description"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4 shrink-0">
              <div>
                <h2 id="multisig-modal-title" className="text-lg sm:text-xl font-bold text-white tracking-tight">
                  {t("title")}
                </h2>
                <p id="multisig-modal-description" className="text-xs text-slate-400 mt-0.5">
                  {isExpired
                    ? (t("expired.badge") || "Expired")
                    : currentStep === "error"
                    ? (t("error.statusLabel") || "Failed")
                    : t("stepOf", {
                        step: currentStep === "review" ? "1" : currentStep === "processing" ? "2" : currentStep === "confirm" ? "3" : "1",
                        total: "3",
                      })}
                </p>
              </div>
              <motion.button
                onClick={handleClose}
                disabled={isLoading || isPendingConfirmation}
                aria-live="polite"
                whileHover={!prefersReducedMotion && !isLoading && !isPendingConfirmation ? { scale: 1.1, backgroundColor: "rgba(255,255,255,0.1)" } : undefined}
                whileTap={!prefersReducedMotion && !isLoading && !isPendingConfirmation ? { scale: 0.9 } : undefined}
                className="rounded-lg p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-slate-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={t("closeModal")}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </motion.button>
            </div>

            {/* Screen reader announcements */}
            <div
              aria-live="assertive"
              aria-atomic="true"
              className="sr-only"
            >
              {currentStep === "processing"
                ? t("announcements.processing")
                : currentStep === "confirm"
                ? t("announcements.confirmed")
                : currentStep === "error"
                ? t("announcements.failed")
                : ""}
            </div>

            {/* Content */}
            <motion.div
              className="px-6 py-5 max-h-[70vh] overflow-y-auto"
              aria-live="polite"
              key={currentStep}
              variants={stepVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {isExpired ? (
                <div className="text-center space-y-5">
                  <div className="w-14 h-14 bg-amber-500/15 rounded-full flex items-center justify-center mx-auto ring-4 ring-amber-500/10">
                    <svg className="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">{t("expired.heading")}</h3>
                    <p className="mt-1.5 text-sm text-slate-400">
                      {t("expired.description")}
                    </p>
                  </div>
                  <motion.button
                    onClick={handleClose}
                    whileHover={!prefersReducedMotion ? { scale: 1.02 } : undefined}
                    whileTap={!prefersReducedMotion ? { scale: 0.98 } : undefined}
                    className="px-6 py-2 bg-slate-600 text-white font-semibold rounded-xl hover:bg-slate-500 transition-colors"
                  >
                    {t("expired.closeButton")}
                  </motion.button>
                </div>
              ) : (
                renderStep()
              )}
            </motion.div>

            {/* Error Display */}
            <AnimatePresence>
              {error && currentStep !== "error" && (
                <motion.div
                  key="error-banner"
                  variants={!prefersReducedMotion ? errorMessageVariants : undefined}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="mx-6 mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4"
                  role="alert"
                >
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-red-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-red-400">{t("error.bannerTitle")}</p>
                      <p className="text-sm text-red-300 mt-1">{error}</p>
                    </div>
                    <motion.button
                      onClick={clearError}
                      whileHover={!prefersReducedMotion ? { scale: 1.1 } : undefined}
                      whileTap={!prefersReducedMotion ? { scale: 0.9 } : undefined}
                      className="text-red-400 hover:text-red-300 transition-colors"
                      aria-label={t("error.clearErrorAriaLabel")}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </motion.button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
