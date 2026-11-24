import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWIPE_DISMISS_DISTANCE_PX } from "@/hooks/useSwipeToDismiss";
import UserNav, { accountInitials } from "./UserNav";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: "/dashboard",
}));

const session = vi.hoisted(() => ({
  merchant: {
    business_name: "Stellar Apex Ltd",
    email: "merchant@stellar.org",
    api_key: "sk_live_secret_value",
    webhook_secret: "whsec_secret_value",
  } as {
    business_name: string;
    email: string;
    api_key?: string;
    webhook_secret?: string;
  } | null,
  logout: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    onClick,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => navigation.pathname,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      openMenu: "Open account menu",
      closeMenu: "Close account menu",
      menuTitle: "Account",
      menuDescription: "Signed-in account, organization, and session actions.",
      organization: "Organization",
      sessionNavigation: "Session navigation",
      dashboard: "Dashboard",
      accountSettings: "Account Settings",
      supportCenter: "Support Center",
      signOut: "Sign Out",
      swipeHint: "Swipe down to close",
    })[key] ?? key,
}));

vi.mock("@/lib/merchant-store", () => ({
  useMerchantMetadata: () => session.merchant,
  useMerchantLogout: () => session.logout,
}));

const originalMatchMedia = window.matchMedia;

function installMatchMedia(drawer: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: drawer && query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function renderNav() {
  return render(<UserNav />);
}

function openMenu() {
  fireEvent.click(screen.getByTestId("user-nav-trigger"));
  return screen.getByTestId("user-nav-menu");
}

/**
 * Drive a touch gesture. `elapsed` is the time between start and release so
 * tests can distinguish a slow drag from a flick.
 */
function swipe(
  element: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  elapsed = 400,
) {
  let now = 1_000;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
  fireEvent.touchStart(element, { touches: [{ clientX: from.x, clientY: from.y }] });
  fireEvent.touchMove(element, { touches: [{ clientX: to.x, clientY: to.y }] });
  now += elapsed;
  fireEvent.touchEnd(element, { changedTouches: [{ clientX: to.x, clientY: to.y }] });
  spy.mockRestore();
}

describe("accountInitials", () => {
  it("uses the first two organization initials", () => {
    expect(accountInitials("Stellar Apex Ltd", "merchant@stellar.org")).toBe("SA");
  });

  it("falls back to the email, then a placeholder", () => {
    expect(accountInitials("  ", "ada@pluto.cc")).toBe("A");
    expect(accountInitials("  ", "  ")).toBe("?");
  });
});

describe("UserNav", () => {
  beforeEach(() => {
    navigation.push.mockClear();
    navigation.pathname = "/dashboard";
    session.logout.mockClear();
    session.merchant = {
      business_name: "Stellar Apex Ltd",
      email: "merchant@stellar.org",
      api_key: "sk_live_secret_value",
      webhook_secret: "whsec_secret_value",
    };
    installMatchMedia(false);
    document.body.style.overflow = "auto";
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    document.body.style.overflow = "";
  });

  it("renders nothing when there is no merchant session", () => {
    session.merchant = null;
    const { container } = renderNav();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the organization on the trigger and keeps secrets out of the menu", () => {
    renderNav();

    expect(screen.getByTestId("user-nav-trigger")).toHaveAccessibleName("Open account menu");
    expect(screen.getByText("SA")).toBeInTheDocument();
    expect(screen.getByText("Stellar Apex Ltd")).toBeInTheDocument();

    openMenu();

    expect(screen.getByRole("dialog", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByTestId("user-nav-organization")).toHaveTextContent("Stellar Apex Ltd");
    expect(screen.getAllByText("merchant@stellar.org").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("sk_live_secret_value");
    expect(document.body.textContent).not.toContain("whsec_secret_value");
  });

  it("marks the current session destination and links to the fixed routes", () => {
    renderNav();
    openMenu();

    expect(screen.getByTestId("user-nav-dashboard")).toHaveAttribute("href", "/dashboard");
    expect(screen.getByTestId("user-nav-dashboard")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("user-nav-settings")).toHaveAttribute("href", "/settings");
    expect(screen.getByTestId("user-nav-settings")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("user-nav-support")).toHaveAttribute("href", "/support");
  });

  it("closes from the close button and returns focus to the trigger", () => {
    renderNav();
    const trigger = screen.getByTestId("user-nav-trigger");
    trigger.focus();
    openMenu();

    expect(screen.getByRole("dialog")).toHaveFocus();
    fireEvent.click(screen.getByTestId("user-nav-close"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on Escape and wraps Tab inside the menu", () => {
    renderNav();
    const trigger = screen.getByTestId("user-nav-trigger");
    trigger.focus();
    openMenu();

    const dialog = screen.getByRole("dialog");
    const closeButton = screen.getByRole("button", { name: "Close account menu" });
    const signOut = screen.getByRole("button", { name: "Sign Out" });

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(signOut).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes the dropdown when pressing outside it, not when pressing inside", () => {
    renderNav();
    openMenu();

    fireEvent.mouseDown(screen.getByTestId("user-nav-dashboard"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("signs out through the merchant store and a fixed login route", () => {
    renderNav();
    openMenu();
    fireEvent.click(screen.getByTestId("user-nav-sign-out"));

    expect(session.logout).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledWith("/login");
    expect(session.logout.mock.invocationCallOrder[0]).toBeLessThan(
      navigation.push.mock.invocationCallOrder[0],
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the desktop menu as a dropdown without a drawer handle or scroll lock", () => {
    renderNav();
    openMenu();

    expect(screen.getByTestId("user-nav-menu")).toHaveAttribute("data-variant", "dropdown");
    expect(screen.queryByTestId("user-nav-drawer-handle")).not.toBeInTheDocument();
    expect(screen.queryByText("Swipe down to close")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("auto");

    swipe(screen.getByTestId("user-nav-menu"), { x: 40, y: 20 }, { x: 40, y: 240 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("UserNav drawer", () => {
  beforeEach(() => {
    navigation.push.mockClear();
    navigation.pathname = "/settings/branding";
    session.logout.mockClear();
    session.merchant = {
      business_name: "Stellar Apex Ltd",
      email: "merchant@stellar.org",
    };
    installMatchMedia(true);
    document.body.style.overflow = "auto";
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    document.body.style.overflow = "";
  });

  it("opens a bottom drawer, locks scroll, and closes from the backdrop", () => {
    renderNav();
    openMenu();

    const menu = screen.getByTestId("user-nav-menu");
    expect(menu).toHaveAttribute("data-variant", "drawer");
    expect(menu).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("user-nav-drawer-handle")).toBeInTheDocument();
    expect(screen.getByText("Swipe down to close")).toBeInTheDocument();
    expect(screen.getByTestId("user-nav-settings")).toHaveAttribute("aria-current", "page");
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByTestId("user-nav-backdrop"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("dismisses on a long downward swipe and on a fast flick", () => {
    renderNav();
    const menu = openMenu();

    swipe(
      menu,
      { x: 80, y: 40 },
      { x: 80, y: 40 + SWIPE_DISMISS_DISTANCE_PX },
      800,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const again = openMenu();
    swipe(again, { x: 80, y: 40 }, { x: 80, y: 90 }, 40);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("snaps back on a short slow drag, an upward swipe, and a sideways swipe", () => {
    renderNav();
    const menu = openMenu();

    swipe(menu, { x: 80, y: 40 }, { x: 80, y: 80 }, 800);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(menu).not.toHaveAttribute("data-dragging");

    swipe(menu, { x: 80, y: 200 }, { x: 80, y: 40 }, 100);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    swipe(menu, { x: 20, y: 80 }, { x: 220, y: 90 }, 100);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not dismiss when the menu body is scrolled down", () => {
    renderNav();
    openMenu();
    const body = screen.getByTestId("user-nav-body");
    body.scrollTop = 48;

    swipe(
      screen.getByTestId("user-nav-dashboard"),
      { x: 40, y: 20 },
      { x: 40, y: 20 + SWIPE_DISMISS_DISTANCE_PX + 40 },
      200,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ignores a touch end that never started", () => {
    renderNav();
    const menu = openMenu();

    fireEvent.touchEnd(menu, { changedTouches: [{ clientX: 10, clientY: 400 }] });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
