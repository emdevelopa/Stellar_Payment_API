/**
 * LazyQRCodeSVG while the library is still loading (#1852).
 *
 * The import of qrcode.react is held open by a gate, so the loading state can be observed.
 * A normal mock resolves instantly and the placeholder would never be on screen.
 */

import React from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LazyQRCodeSVG from "./LazyQRCodeSVG";

const gate = vi.hoisted(() => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
});

vi.mock("qrcode.react", async () => {
  await gate.promise;
  return { QRCodeSVG: () => <svg data-testid="qr" /> };
});

describe("LazyQRCodeSVG while loading", () => {
  it("reserves the space, shows a placeholder hidden from assistive technology, then swaps in the code", async () => {
    const { container } = render(<LazyQRCodeSVG value="x" size={200} />);
    const wrapper = container.firstElementChild as HTMLElement;

    // Loading: the size is held, a placeholder is shown, and the code is not there yet.
    expect(wrapper).toHaveStyle({ width: "200px", height: "200px" });
    expect(screen.queryByTestId("qr")).not.toBeInTheDocument();
    const placeholder = wrapper.querySelector(".animate-pulse");
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveAttribute("aria-hidden", "true");

    await act(async () => gate.open());

    // Loaded: the code replaces the placeholder, in the same reserved box.
    expect(await screen.findByTestId("qr")).toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).not.toBeInTheDocument();
    expect(wrapper).toHaveStyle({ width: "200px", height: "200px" });
  });
});
