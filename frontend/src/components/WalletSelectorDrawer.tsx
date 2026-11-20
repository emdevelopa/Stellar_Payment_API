"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import WalletSelector from "./WalletSelector";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useSwipeToDismiss } from "@/hooks/useSwipeToDismiss";

interface WalletSelectorDrawerProps {
  networkPassphrase: string;
  onConnected: () => void;
}

/**
 * The wallet picker as a drawer, for small screens (#1850).
 *
 * On a phone a stack of wallet buttons sits awkwardly in the middle of a checkout page,
 * so this shows one "Connect wallet" button that opens the picker as a bottom sheet. From
 * `sm` up the sheet is a centred dialog, so it also works as a modal on a desktop.
 *
 * - **Touch:** drag the handle (or anywhere on the sheet, when its content is scrolled to
 *   the top) down to dismiss, with the sheet following the finger and snapping back on a
 *   short drag. See `useSwipeToDismiss`.
 * - **Not touch:** the close button and Escape always work (WCAG 2.5.1: a gesture must
 *   have a non-gesture alternative), focus moves into the sheet, stays there, and returns
 *   to the button that opened it.
 * - It closes by itself once a wallet connects.
 */
export default function WalletSelectorDrawer({
  networkPassphrase,
  onConnected,
}: WalletSelectorDrawerProps) {
  const t = useTranslations("walletSelector");
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const dialogRef = useFocusTrap<HTMLDivElement>({
    enabled: open,
    onEscape: close,
    focusContainerOnActivate: true,
  });
  const swipe = useSwipeToDismiss({ onDismiss: close, enabled: open, scrollRef });

  // The page behind must not scroll while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const handleConnected = useCallback(() => {
    setOpen(false);
    onConnected();
  }, [onConnected]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#0A0A0A] text-sm font-bold uppercase tracking-widest text-white shadow-lg shadow-black/10 transition-all hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-300)] focus-visible:ring-offset-2 active:scale-[0.98]"
      >
        {t("connectWallet")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
          style={{
            backgroundColor:
              swipe.offset > 0
                ? `rgba(0,0,0,${Math.max(0.2, 0.6 - swipe.offset / 600)})`
                : undefined,
          }}
          onClick={close}
          data-testid="wallet-drawer-backdrop"
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            data-testid="wallet-drawer"
            data-dragging={swipe.dragging || undefined}
            style={{
              transform: swipe.offset > 0 ? `translate3d(0, ${swipe.offset}px, 0)` : undefined,
            }}
            className={`flex max-h-[90dvh] w-full flex-col rounded-t-[2rem] border-t border-[#E8E8E8] bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-20px_60px_rgba(0,0,0,0.25)] focus:outline-none motion-safe:animate-palette-drawer-in sm:max-w-md sm:rounded-[2rem] sm:border sm:pb-0 sm:motion-safe:animate-none ${
              swipe.dragging
                ? ""
                : "transition-transform duration-200 ease-out motion-reduce:transition-none"
            }`}
            onClick={(event) => event.stopPropagation()}
            {...swipe.handlers}
          >
            {/* Drag handle: a touch affordance only; the close button is the alternative. */}
            <div
              className="flex shrink-0 touch-none justify-center pb-1 pt-3 sm:hidden"
              data-testid="wallet-drawer-handle"
              aria-hidden="true"
            >
              <span className="h-1.5 w-10 rounded-full bg-[#D4D4D4]" />
            </div>

            <div className="flex items-center justify-between gap-4 px-6 pb-1 pt-3 sm:pt-6">
              {/* The picker below has its own "Choose a wallet" heading and description. */}
              <h2 id={titleId} className="text-base font-bold text-[#0A0A0A]">
                {t("connectWallet")}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label={t("closeWalletSelector")}
                className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#6B6B6B] transition-colors hover:bg-[#F5F5F5] hover:text-[#0A0A0A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pluto-300)]"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 pt-2"
            >
              <WalletSelector networkPassphrase={networkPassphrase} onConnected={handleConnected} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
