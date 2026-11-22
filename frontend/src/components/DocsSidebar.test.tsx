import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DocsSidebar from "./DocsSidebar";

let mockPathname = "/docs";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("DocsSidebar", () => {
  beforeEach(() => {
    mockPathname = "/docs";
    document.body.style.overflow = "";
  });

  it("renders desktop navigation links with aria-current on the active route", () => {
    mockPathname = "/docs/api-guide";
    render(<DocsSidebar />);

    const nav = screen.getByRole("navigation", { name: "Documentation navigation" });
    expect(nav).toBeInTheDocument();

    const activeLink = screen.getByRole("link", { name: /API/i });
    expect(activeLink).toHaveAttribute("aria-current", "page");
  });

  it("opens and closes the mobile drawer via trigger button, close button, and Escape", () => {
    render(<DocsSidebar />);

    const trigger = screen.getByRole("button", { name: "Open documentation menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Documentation navigation drawer" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Documentation navigation drawer" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("supports left-edge swipe-right to open and swipe-left to close the drawer", () => {
    render(<DocsSidebar />);

    fireEvent.touchStart(window, { touches: [{ clientX: 12 }] });
    fireEvent.touchEnd(window, { changedTouches: [{ clientX: 100 }] });

    const drawer = screen.getByRole("dialog", { name: "Documentation navigation drawer" });
    expect(drawer).toBeInTheDocument();

    fireEvent.touchStart(drawer, { touches: [{ clientX: 200 }] });
    fireEvent.touchMove(drawer, { touches: [{ clientX: 110 }] });
    fireEvent.touchEnd(drawer);

    expect(screen.queryByRole("dialog", { name: "Documentation navigation drawer" })).not.toBeInTheDocument();
  });

  it("closes the drawer when the backdrop is clicked", () => {
    render(<DocsSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Open documentation menu" }));
    fireEvent.click(screen.getByTestId("docs-drawer-backdrop"));

    expect(screen.queryByRole("dialog", { name: "Documentation navigation drawer" })).not.toBeInTheDocument();
  });
});
