/**
 * Tests for UserNav, the signed-in merchant's account menu.
 *
 * #1844: keyboard focus management and screen reader labels (menu button pattern).
 * #1848: snapshot tests and a user interaction suite.
 */

import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import UserNav from "./UserNav";

const merchant = vi.hoisted(() => ({ current: null as null | { business_name: string; email: string } }));
const logout = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

// The real next/link forwards its ref. Radix's `asChild` needs that to track the item for
// keyboard navigation, so the stand-in must forward it too.
vi.mock("next/link", async () => {
  const { forwardRef } = await import("react");
  return {
    default: forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>(
      function Link({ href, children, ...rest }, ref) {
        return (
          <a ref={ref} href={href} {...rest}>
            {children}
          </a>
        );
      },
    ),
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/lib/merchant-store", () => ({
  useMerchantMetadata: () => merchant.current,
  useMerchantLogout: () => logout,
}));

// Radix measures and scrolls with browser APIs jsdom does not implement.
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  window.HTMLElement.prototype.setPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const ACME = { business_name: "Acme Corp", email: "ops@acme.test" };

// Radix marks everything outside an open menu `aria-hidden`, which is correct for assistive
// technology, so the trigger has to be looked up with `hidden: true` while the menu is open.
const trigger = () => screen.getByRole("button", { name: /account menu/i, hidden: true });
const menu = () => screen.getByRole("menu");

function setup(current: typeof merchant.current = ACME) {
  merchant.current = current;
  // An open modal menu sets `pointer-events: none` on the body, so clicking "outside" it
  // would be refused by user-event's own check, though a real user can do it.
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const view = render(<UserNav />);
  return { user, ...view };
}

/**
 * A copy of `node` with Radix's auto-generated ids (`radix-:r5:`) replaced by a fixed
 * placeholder. They depend on how many components rendered before, so a snapshot that kept
 * them would fail whenever the tests ran in a different order or on their own.
 */
function stable(node: Element): Element {
  const clone = node.cloneNode(true) as Element;
  for (const element of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
    for (const name of ["id", "aria-controls", "aria-labelledby", "aria-describedby"]) {
      const value = element.getAttribute(name);
      if (value) element.setAttribute(name, value.replace(/radix-:[0-9a-z]+:/g, "radix-:id:"));
    }
  }
  return clone;
}

async function openWithKeyboard(user: ReturnType<typeof userEvent.setup>) {
  await user.tab();
  await user.keyboard("{Enter}");
  await screen.findByRole("menu");
}

beforeEach(() => {
  logout.mockClear();
  push.mockClear();
  merchant.current = ACME;
});

afterEach(() => {
  merchant.current = null;
});

describe("UserNav rendering", () => {
  it("renders nothing when nobody is signed in", () => {
    const { container } = setup(null);

    expect(container).toBeEmptyDOMElement();
  });

  it("matches the snapshot for a merchant with a business name (closed)", () => {
    const { container } = setup();

    expect(stable(container)).toMatchSnapshot();
  });

  it("matches the snapshot for a merchant without a business name (closed)", () => {
    const { container } = setup({ business_name: "", email: "solo@acme.test" });

    expect(stable(container)).toMatchSnapshot();
  });

  it("matches the snapshot of the open menu", async () => {
    const { user } = setup();

    await user.click(trigger());

    expect(stable(await screen.findByRole("menu"))).toMatchSnapshot();
  });

  it.each([
    ["Acme Corp", "AC"],
    ["Acme", "A"],
    ["Acme Widgets International", "AW"],
    ["acme corp", "AC"],
  ])("shows %j as the initials %j", (business_name, expected) => {
    setup({ business_name, email: "x@y.test" });

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("falls back to the first letter of the email when there is no business name", () => {
    setup({ business_name: "", email: "zed@acme.test" });

    expect(screen.getByText("Z")).toBeInTheDocument();
  });

  it("shows the business name and email next to the avatar", () => {
    setup();

    expect(screen.getAllByText("Acme Corp").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ops@acme.test").length).toBeGreaterThan(0);
  });

  it("is closed to begin with", () => {
    setup();

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("UserNav screen reader labels (#1844)", () => {
  it("names the button with its visible text, then what it is for (label in name)", () => {
    setup();

    expect(trigger()).toHaveAccessibleName("Acme Corp ops@acme.test, account menu");
  });

  it("names the button from the email alone when there is no business name", () => {
    setup({ business_name: "", email: "solo@acme.test" });

    expect(trigger()).toHaveAccessibleName("solo@acme.test, account menu");
  });

  it("tells assistive technology the button opens a menu, and whether it is open", async () => {
    const { user } = setup();
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });

  it("points the button at the menu it controls", async () => {
    const { user } = setup();

    await user.click(trigger());

    expect(trigger().getAttribute("aria-controls")).toBe(menu().id);
  });

  it("hides the decorative initials and every icon from assistive technology", async () => {
    const { user } = setup();
    await user.click(trigger());

    expect(screen.getByText("AC")).toHaveAttribute("aria-hidden", "true");
    expect(document.body.querySelectorAll("svg:not([aria-hidden='true'])")).toHaveLength(0);
  });

  it("is a menu of named menu items", async () => {
    const { user } = setup();
    await user.click(trigger());

    const items = within(menu()).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Dashboard",
      "Account Settings",
      "Support Center",
      "Sign Out",
    ]);
  });

  it("links the navigation items to their pages", async () => {
    const { user } = setup();
    await user.click(trigger());

    expect(screen.getByRole("menuitem", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("menuitem", { name: "Account Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("menuitem", { name: "Support Center" })).toHaveAttribute("href", "/support");
  });

  it("separates Sign Out from the navigation items", async () => {
    const { user } = setup();
    await user.click(trigger());

    expect(within(menu()).getByRole("separator")).toBeInTheDocument();
  });

  it("gives the button a visible keyboard focus ring", () => {
    setup();

    expect(trigger()).toHaveClass("focus-visible:ring-2");
  });
});

describe("UserNav opening and closing", () => {
  it("opens when the button is clicked", async () => {
    const { user } = setup();

    await user.click(trigger());

    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("closes when the button is clicked again", async () => {
    const { user } = setup();
    await user.click(trigger());
    await screen.findByRole("menu");

    await user.click(trigger());

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("closes when Escape is pressed", async () => {
    const { user } = setup();
    await user.click(trigger());
    await screen.findByRole("menu");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("returns focus to the button after Escape", async () => {
    const { user } = setup();
    await openWithKeyboard(user);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("closes when the user clicks outside it", async () => {
    const { user } = setup();
    await user.click(trigger());
    await screen.findByRole("menu");

    await user.click(document.body);

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("keeps focus inside the open menu when Tab is pressed (it is modal)", async () => {
    const { user } = setup();
    await openWithKeyboard(user);
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Dashboard" })).toHaveFocus());

    await user.tab();

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(within(menu()).getAllByRole("menuitem")).toContain(document.activeElement);
  });

  it("closes after a navigation item is chosen", async () => {
    const { user } = setup();
    await user.click(trigger());

    await user.click(await screen.findByRole("menuitem", { name: "Account Settings" }));

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("can be reopened after closing", async () => {
    const { user } = setup();
    await user.click(trigger());
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    await user.click(trigger());

    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });
});

describe("UserNav keyboard operation (#1844)", () => {
  it("is reachable with Tab", async () => {
    const { user } = setup();

    await user.tab();

    expect(trigger()).toHaveFocus();
  });

  it.each(["{Enter}", " ", "{ArrowDown}"])("opens with %j", async (key) => {
    const { user } = setup();
    await user.tab();

    await user.keyboard(key);

    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("moves focus to the first item when opened from the keyboard", async () => {
    const { user } = setup();

    await openWithKeyboard(user);

    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Dashboard" })).toHaveFocus());
  });

  it("moves down and up through the items with the arrow keys", async () => {
    const { user } = setup();
    await openWithKeyboard(user);

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Account Settings" })).toHaveFocus());

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Support Center" })).toHaveFocus());

    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Account Settings" })).toHaveFocus());
  });

  it("wraps from the last item to the first", async () => {
    const { user } = setup();
    await openWithKeyboard(user);

    await user.keyboard("{End}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Sign Out" })).toHaveFocus());

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Dashboard" })).toHaveFocus());
  });

  it("jumps to the first and last items with Home and End", async () => {
    const { user } = setup();
    await openWithKeyboard(user);

    await user.keyboard("{End}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Sign Out" })).toHaveFocus());

    await user.keyboard("{Home}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Dashboard" })).toHaveFocus());
  });

  it("moves to an item by typing its first letter", async () => {
    const { user } = setup();
    await openWithKeyboard(user);

    await user.keyboard("a");

    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Account Settings" })).toHaveFocus());
  });
});

describe("UserNav signing out", () => {
  it("signs out and goes to the login page", async () => {
    const { user } = setup();
    await user.click(trigger());

    await user.click(await screen.findByRole("menuitem", { name: "Sign Out" }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/login");
  });

  it("signs out with the keyboard", async () => {
    const { user } = setup();
    await openWithKeyboard(user);
    await user.keyboard("{End}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Sign Out" })).toHaveFocus());

    await user.keyboard("{Enter}");

    expect(logout).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/login");
  });

  it("signs out before navigating", async () => {
    const calls: string[] = [];
    logout.mockImplementation(() => calls.push("logout"));
    push.mockImplementation(() => calls.push("push"));
    const { user } = setup();
    await user.click(trigger());

    await user.click(await screen.findByRole("menuitem", { name: "Sign Out" }));

    expect(calls).toEqual(["logout", "push"]);
    logout.mockReset();
    push.mockReset();
  });

  it("does not sign out when navigating to another page", async () => {
    const { user } = setup();
    await user.click(trigger());

    await user.click(await screen.findByRole("menuitem", { name: "Dashboard" }));

    expect(logout).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("does not sign out just by opening the menu", async () => {
    const { user } = setup();

    await user.click(trigger());
    await screen.findByRole("menu");

    expect(logout).not.toHaveBeenCalled();
  });
});
