"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useRouter } from "next/navigation";
import { useMerchantMetadata, useMerchantLogout } from "@/lib/merchant-store";

// Shared by the menu items. `data-[highlighted]` is Radix's state for the item the keyboard
// (or pointer) is on, so arrow-key navigation looks the same as hover (WCAG 2.4.7).
const ITEM =
  "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#0A0A0A]";

const ICON_PROPS = {
  className: "h-4 w-4",
  fill: "none",
  stroke: "currentColor",
  viewBox: "0 0 24 24",
  "aria-hidden": true,
  focusable: false,
} as const;

/**
 * The signed-in merchant's account menu.
 *
 * Built on Radix's dropdown menu, which provides the menu button pattern: the trigger
 * exposes `aria-haspopup`, `aria-expanded` and `aria-controls`; the list is a `menu` of
 * `menuitem`s; Enter, Space and ArrowDown open it; arrow keys, Home, End and typing move
 * through it; Escape and Tab close it; and focus returns to the trigger (WCAG 2.1.1,
 * 2.4.3, 4.1.2).
 */
export default function UserNav() {
  const merchant = useMerchantMetadata();
  const logout = useMerchantLogout();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  if (!merchant) return null;

  const initials = merchant.business_name
    ? merchant.business_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : merchant.email[0].toUpperCase();

  // The accessible name contains the text shown on the button, in the same order
  // (WCAG 2.5.3 Label in Name), and says what the button is for.
  const visibleText = [merchant.business_name, merchant.email].filter(Boolean).join(" ");

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`${visibleText}, account menu`}
          className="flex items-center gap-3 rounded-full border border-[#E8E8E8] bg-white p-1 pr-4 transition-all hover:border-[#0A0A0A] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0A] focus-visible:ring-offset-2 active:scale-[0.98]"
        >
          <div
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0A0A0A] text-[10px] font-bold text-white uppercase tracking-tighter"
          >
            {initials}
          </div>
          <div className="hidden flex-col items-start text-left sm:flex">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A]">
              {merchant.business_name}
            </span>
            <span className="text-[9px] font-medium text-[#6B6B6B]">
              {merchant.email}
            </span>
          </div>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={12}
          loop
          className="z-50 w-56 origin-top-right rounded-2xl border border-[#E8E8E8] bg-white p-2 shadow-2xl animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
        >
          <DropdownMenu.Label className="mb-1 border-b border-[#F5F5F5] px-3 py-2 sm:hidden">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] truncate">{merchant.business_name}</p>
            <p className="text-[9px] font-medium text-[#6B6B6B] truncate">{merchant.email}</p>
          </DropdownMenu.Label>

          <DropdownMenu.Item asChild>
            <Link
              href="/dashboard"
              className={`${ITEM} text-[#0A0A0A] bg-[#F5F5F5] data-[highlighted]:bg-[#E8E8E8]`}
            >
              <svg {...ICON_PROPS}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              Dashboard
            </Link>
          </DropdownMenu.Item>

          <DropdownMenu.Item asChild>
            <Link
              href="/settings"
              className={`${ITEM} text-[#6B6B6B] data-[highlighted]:bg-[#F9F9F9] data-[highlighted]:text-[#0A0A0A]`}
            >
              <svg {...ICON_PROPS}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Account Settings
            </Link>
          </DropdownMenu.Item>

          <DropdownMenu.Item asChild>
            <Link
              href="/support"
              className={`${ITEM} text-[#6B6B6B] data-[highlighted]:bg-[#F9F9F9] data-[highlighted]:text-[#0A0A0A]`}
            >
              <svg {...ICON_PROPS}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Support Center
            </Link>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-[#F5F5F5]" />

          <DropdownMenu.Item
            onSelect={handleLogout}
            className={`${ITEM} text-red-600 data-[highlighted]:bg-red-50`}
          >
            <svg {...ICON_PROPS}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
