"use client";

/**
 * NotificationCenter
 *
 * Implements:
 *  - #1187 i18n via next-intl (useTranslations)
 *  - #1188 Accessibility (ARIA), responsive Tailwind design, clean CSS variables
 *  - #1189 Exported as a named component + default; consumers can dynamic-import
 *          the panel content to keep the initial JS bundle lean.
 */

import { BellIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { useNotificationCenter, type Notification } from "@/hooks/useNotificationCenter";

// ─── Panel ────────────────────────────────────────────────────────────────────
// Accepts state via props so it can be tree-shaken / dynamic-imported separately
// without owning duplicate hook state.
interface NotificationPanelProps {
  notifications: Notification[];
  unreadCount: number;
  handleDismiss: (id: string) => void;
}

export function NotificationPanel({
  notifications,
  unreadCount,
  handleDismiss,
}: NotificationPanelProps) {
  const t = useTranslations("notificationCenter");

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={[
        // Position & size — full-width on mobile, fixed width on desktop
        "absolute right-0 mt-3",
        "w-[calc(100vw-2rem)] max-w-xs sm:w-80",
        "max-h-[min(32rem,80vh)] overflow-y-auto",
        // Visual
        "rounded-xl border border-[#E8E8E8]",
        "bg-white shadow-2xl",
        // Stack above everything
        "z-50 p-5",
        // Prevent scroll chaining on mobile
        "overscroll-contain",
      ].join(" ")}
      role="dialog"
      aria-modal="true"
      aria-label={t("panelLabel")}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-bold text-[#0A0A0A] uppercase tracking-widest leading-none">
          {t("heading")}
        </h3>
        <span
          className="text-[10px] font-medium text-[#6B6B6B] bg-[#F5F5F5] px-2 py-0.5 rounded-full"
          aria-live="polite"
          aria-atomic="true"
        >
          {t("unreadCount", { count: unreadCount })}
        </span>
      </div>

      {/* Notification list */}
      <div
        className="flex flex-col gap-2"
        role="list"
        aria-label={t("heading")}
      >
        <AnimatePresence mode="popLayout">
          {notifications.length === 0 ? (
            <motion.p
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-[11px] font-bold text-[#A0A0A0] uppercase tracking-widest text-center py-8"
              role="status"
            >
              {t("noAlerts")}
            </motion.p>
          ) : (
            notifications.map((notif, index) => (
              <motion.div
                key={notif.id ?? index}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16, scale: 0.92 }}
                transition={{ delay: index * 0.04, duration: 0.18 }}
                className={[
                  "relative rounded-lg",
                  "bg-[#F9F9F9] border border-[#E8E8E8]",
                  "p-3 group",
                  "hover:bg-[#F0F0F0] focus-within:ring-2 focus-within:ring-[#00F5D4]/40",
                  "transition-colors duration-150",
                ].join(" ")}
                role="listitem"
                aria-label={t("notificationLabel", { message: notif.message })}
              >
                {/* Dismiss button — visible on keyboard focus; hover-reveal on pointer */}
                <button
                  onClick={() => notif.id && handleDismiss(notif.id)}
                  className={[
                    "absolute top-2 right-2 p-1 rounded",
                    "text-[#6B6B6B] hover:text-[#0A0A0A]",
                    "hover:bg-[#E8E8E8]",
                    "opacity-0 group-hover:opacity-100 focus:opacity-100",
                    "transition-opacity duration-150",
                    // Minimum touch target
                    "min-h-[32px] min-w-[32px] flex items-center justify-center",
                  ].join(" ")}
                  aria-label={t("dismissLabel", { message: notif.message })}
                >
                  <XMarkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                </button>

                {/* Alert type badge */}
                <p className="text-[9px] font-bold text-[#0A0A0A] uppercase tracking-widest mb-1 leading-none">
                  {t("alertLabel")}
                </p>

                {/* Message */}
                <p className="text-xs font-medium text-[#6B6B6B] leading-relaxed pr-7">
                  {notif.message}
                </p>

                {/* Timestamp */}
                {notif.timestamp && (
                  <p
                    className="text-[10px] text-[#A0A0A0] mt-1.5"
                    aria-label={t("timestampLabel", { timestamp: notif.timestamp })}
                  >
                    {new Date(notif.timestamp).toLocaleString()}
                  </p>
                )}
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── Trigger button + panel container ────────────────────────────────────────
// Single hook instance — state flows down to both button and panel.
export function NotificationCenter() {
  const t = useTranslations("notificationCenter");
  const { notifications, unreadCount, isOpen, toggleOpen, handleDismiss } =
    useNotificationCenter();

  return (
    <div className="relative">
      {/* Bell button */}
      <motion.button
        onClick={toggleOpen}
        className={[
          "relative flex items-center justify-center",
          "p-2.5 rounded-lg",
          "border border-[#E8E8E8] bg-white",
          "text-[#6B6B6B] hover:text-[#0A0A0A] hover:bg-[#F5F5F5]",
          // WCAG 2.5.5 — minimum 44 × 44 px touch target
          "min-h-[44px] min-w-[44px]",
          "transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F5D4]/60",
        ].join(" ")}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label={
          unreadCount > 0
            ? t("buttonLabelWithCount", { count: unreadCount })
            : t("buttonLabel")
        }
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <BellIcon className="h-5 w-5" aria-hidden="true" />

        {/* Decorative unread indicator */}
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute top-2 right-2 flex h-2 w-2"
              aria-hidden="true"
            >
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00F5D4] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00F5D4] border border-black shadow-[0_0_8px_#00F5D4]" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <NotificationPanel
            key="panel"
            notifications={notifications}
            unreadCount={unreadCount}
            handleDismiss={handleDismiss}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default NotificationCenter;
