"use client";

/**
 * Account profile and session navigation (#1845).
 *
 * Responsive layout (Drips Wave / Pluto, authenticated shell):
 * - Below the `md` breakpoint (768px) the menu is a bottom drawer: full
 *   width, rounded top, drag handle, and safe-area padding. It is portaled
 *   to `document.body` so the header stacking context cannot clip it.
 * - From `md` up it is an anchored dropdown beside the merchant avatar.
 *
 * Touch (drawer only):
 * - A downward swipe of at least 100px, or a fast downward flick, dismisses
 *   the sheet. The sheet follows the finger and snaps back otherwise.
 * - A drag that starts inside the scrollable body is ignored unless that
 *   body is already at the top, so the menu can still scroll.
 *
 * Every gesture has a non-gesture control (WCAG 2.5.1 and 2.1.2): Close,
 * the backdrop, and Escape. Focus moves into the dialog, Tab wraps inside
 * it, and focus returns to the trigger on close (WCAG 2.4.3). Body scroll
 * is locked while the drawer is open.
 *
 * Session sign-out clears the merchant store and navigates to the fixed
 * `/login` route. Business name and email are rendered as text. API keys
 * and webhook secrets are never read or rendered here.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowRightStartOnRectangleIcon,
  ChevronDownIcon,
  Cog6ToothIcon,
  LifebuoyIcon,
  Squares2X2Icon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useSwipeToDismiss } from "@/hooks/useSwipeToDismiss";
import { useMerchantLogout, useMerchantMetadata } from "@/lib/merchant-store";

/** Tailwind `md` starts at 768px. Phones and small tablets get the drawer. */
const DRAWER_MEDIA_QUERY = "(max-width: 767px)";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type MenuIcon = typeof Squares2X2Icon;

const MENU_LINKS: { href: string; labelKey: "dashboard" | "accountSettings" | "supportCenter"; testId: string; icon: MenuIcon }[] = [
  { href: "/dashboard", labelKey: "dashboard", testId: "user-nav-dashboard", icon: Squares2X2Icon },
  { href: "/settings", labelKey: "accountSettings", testId: "user-nav-settings", icon: Cog6ToothIcon },
  { href: "/support", labelKey: "supportCenter", testId: "user-nav-support", icon: LifebuoyIcon },
];

/**
 * Up to two initials from the organization name, falling back to the email.
 * Returns "?" when both are blank so the avatar never crashes on empty data.
 */
export function accountInitials(businessName: string, email: string): string {
  const source = businessName.trim() || email.trim();
  if (!source) return "?";

  const letters = source
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return letters.slice(0, 2) || "?";
}

function useDrawerViewport() {
  const [isDrawer, setIsDrawer] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(DRAWER_MEDIA_QUERY);
    const update = () => setIsDrawer(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isDrawer;
}

function isCurrentPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface AccountMenuDialogProps {
  variant: "drawer" | "dropdown";
  panelId: string;
  panelRef: React.RefObject<HTMLDivElement | null>;
  displayName: string;
  email: string;
  pathname: string;
  onClose: () => void;
  onLogout: () => void;
}

function AccountMenuDialog({
  variant,
  panelId,
  panelRef,
  displayName,
  email,
  pathname,
  onClose,
  onLogout,
}: AccountMenuDialogProps) {
  const t = useTranslations("userNav");
  const titleId = useId();
  const descriptionId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const isDrawer = variant === "drawer";

  const { offset, dragging, handlers } = useSwipeToDismiss({
    onDismiss: onClose,
    enabled: isDrawer,
    scrollRef: bodyRef,
  });

  // Enter animation is removed once it finishes (or the user drags) so the
  // swipe transform is not overridden by the keyframe.
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setEntered(true);
    }
  }, []);

  useEffect(() => {
    if (dragging) setEntered(true);
  }, [dragging]);

  const panelTransform = isDrawer && offset > 0 ? `translate3d(0, ${offset}px, 0)` : undefined;
  const linkClass =
    "flex min-h-11 items-center gap-3 rounded-xl px-3 text-[10px] font-bold uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] active:bg-[#EFEFEF]";

  const panel = (
    <div
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-modal={isDrawer}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
      data-testid="user-nav-menu"
      data-variant={variant}
      data-dragging={dragging ? "true" : undefined}
      onAnimationEnd={() => setEntered(true)}
      {...(isDrawer ? handlers : {})}
      style={{ transform: panelTransform }}
      className={
        isDrawer
          ? `relative z-10 flex max-h-[min(85dvh,40rem)] w-full flex-col overflow-hidden rounded-t-3xl border border-b-0 border-[#E8E8E8] bg-white pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-[0_-24px_60px_rgba(0,0,0,0.16)] outline-none motion-reduce:transition-none ${
              entered || dragging ? "" : "motion-safe:animate-drawer-in"
            } ${
              dragging
                ? "will-change-transform"
                : "transition-transform duration-200 ease-out motion-reduce:transition-none"
            }`
          : `absolute right-0 z-50 mt-3 flex w-72 origin-top-right flex-col overflow-hidden rounded-2xl border border-[#E8E8E8] bg-white shadow-[0_20px_50px_rgba(0,0,0,0.12)] outline-none ${
              entered ? "" : "motion-safe:animate-dialog-in"
            }`
      }
    >
      {isDrawer && (
        <div
          className="flex shrink-0 touch-none justify-center pb-1 pt-3"
          data-testid="user-nav-drawer-handle"
          aria-hidden="true"
        >
          <span
            className={`h-1.5 w-12 rounded-full transition-colors motion-reduce:transition-none ${
              dragging ? "bg-mint" : "bg-[#D4D4D4]"
            }`}
          />
        </div>
      )}

      <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-3 pt-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A]">
            {t("menuTitle")}
          </h2>
          <p id={descriptionId} className="sr-only">
            {t("menuDescription")}
          </p>
          <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.18em] text-[#6B6B6B]">
            {t("organization")}
          </p>
          <p className="mt-1 truncate text-sm font-bold text-[#0A0A0A]" data-testid="user-nav-organization">
            {displayName}
          </p>
          {email ? <p className="truncate text-[11px] text-[#6B6B6B]">{email}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closeMenu")}
          data-testid="user-nav-close"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#6B6B6B] transition-colors hover:bg-[#F5F5F5] hover:text-[#0A0A0A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A]"
        >
          <XMarkIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div
        ref={bodyRef}
        className="overflow-y-auto overscroll-contain px-3 pb-3"
        data-testid="user-nav-body"
      >
        <nav aria-label={t("sessionNavigation")} className="flex flex-col gap-1">
          {MENU_LINKS.map((item) => {
            const Icon = item.icon;
            const current = isCurrentPath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                data-testid={item.testId}
                aria-current={current ? "page" : undefined}
                className={`${linkClass} ${
                  current
                    ? "bg-[#F5F5F5] text-[#0A0A0A]"
                    : "text-[#6B6B6B] hover:bg-[#F9F9F9] hover:text-[#0A0A0A]"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className="my-2 h-px bg-[#F5F5F5]" aria-hidden="true" />

        <button
          type="button"
          onClick={onLogout}
          data-testid="user-nav-sign-out"
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-[10px] font-bold uppercase tracking-widest text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 active:bg-red-100"
        >
          <ArrowRightStartOnRectangleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t("signOut")}
        </button>
      </div>

      {isDrawer && (
        <p className="px-4 pb-2 text-center text-[11px] text-[#6B6B6B]">{t("swipeHint")}</p>
      )}
    </div>
  );

  if (!isDrawer) return panel;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end" data-testid="user-nav-overlay">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm motion-reduce:backdrop-blur-none"
        style={{ opacity: offset > 0 ? Math.max(0.12, 0.4 - offset / 500) : undefined }}
        onClick={onClose}
        data-testid="user-nav-backdrop"
        aria-hidden="true"
      />
      {panel}
    </div>,
    document.body,
  );
}

export default function UserNav() {
  const t = useTranslations("userNav");
  const merchant = useMerchantMetadata();
  const logout = useMerchantLogout();
  const router = useRouter();
  const pathname = usePathname();
  const isDrawer = useDrawerViewport();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  const handleLogout = useCallback(() => {
    setOpen(false);
    logout();
    router.push("/login");
  }, [logout, router]);

  // Focus trap and Escape. Depends on the open variant so a resize rebinds
  // the trap to the newly mounted panel. Escape always leaves the menu, so
  // the trap is not a keyboard trap (WCAG 2.1.2).
  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === panel)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, isDrawer]);

  // Dropdown only. The drawer uses its backdrop; a document listener would
  // also see presses inside the portaled sheet and close it immediately.
  useEffect(() => {
    if (!open || isDrawer) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, isDrawer]);

  useEffect(() => {
    if (!open || !isDrawer) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open, isDrawer]);

  if (!merchant) return null;

  const displayName = merchant.business_name.trim() || merchant.email.trim() || t("menuTitle");
  const email = merchant.email.trim();
  const initials = accountInitials(merchant.business_name, merchant.email);

  return (
    <div className="relative" ref={rootRef} data-testid="user-nav">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-full border border-[#E8E8E8] bg-white p-1 pr-2 transition-all hover:border-[#0A0A0A] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] focus-visible:ring-offset-2 active:scale-[0.98] motion-reduce:transform-none sm:gap-3 sm:pr-3"
        aria-label={t("openMenu")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid="user-nav-trigger"
      >
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0A0A0A] text-[10px] font-bold uppercase tracking-tighter text-white"
          aria-hidden="true"
        >
          {initials}
        </span>
        <span className="hidden min-w-0 max-w-[10rem] flex-col items-start text-left sm:flex">
          <span className="w-full truncate text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A]">
            {displayName}
          </span>
          {email ? (
            <span className="w-full truncate text-[9px] font-medium text-[#6B6B6B]">{email}</span>
          ) : null}
        </span>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 text-[#6B6B6B] transition-transform duration-200 motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <AccountMenuDialog
          variant={isDrawer ? "drawer" : "dropdown"}
          panelId={panelId}
          panelRef={panelRef}
          displayName={displayName}
          email={email}
          pathname={pathname}
          onClose={close}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
