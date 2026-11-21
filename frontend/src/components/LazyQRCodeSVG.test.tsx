/**
 * Tests for LazyQRCodeSVG (#1852): qrcode.react loaded on demand, with the displayed size
 * reserved so the page does not jump when the code appears.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LazyQRCodeSVG from "./LazyQRCodeSVG";

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value, title, size, level }: { value: string; title?: string; size?: number; level?: string }) => (
    <svg data-testid="qr" data-value={value} data-title={title} data-size={size} data-level={level} />
  ),
}));

describe("LazyQRCodeSVG", () => {
  it("shows the QR code once the library has loaded", async () => {
    render(<LazyQRCodeSVG value="wc:abc" size={200} />);

    expect(await screen.findByTestId("qr")).toHaveAttribute("data-value", "wc:abc");
  });

  it("passes every prop through to the QR code", async () => {
    render(<LazyQRCodeSVG value="wc:abc" size={256} level="H" title="Scan to pay" />);

    const qr = await screen.findByTestId("qr");
    expect(qr).toHaveAttribute("data-title", "Scan to pay");
    expect(qr).toHaveAttribute("data-size", "256");
    expect(qr).toHaveAttribute("data-level", "H");
  });

  it("reserves the size prop as the displayed size", async () => {
    const { container } = render(<LazyQRCodeSVG value="x" size={200} />);

    expect(container.firstElementChild).toHaveStyle({ width: "200px", height: "200px" });
    await screen.findByTestId("qr");
  });

  it("reserves the style width and height instead when they differ from size", async () => {
    // The checkout page renders a 256-unit code at 72px.
    const { container } = render(
      <LazyQRCodeSVG value="x" size={256} style={{ width: "72px", height: "72px" }} />,
    );

    expect(container.firstElementChild).toHaveStyle({ width: "72px", height: "72px" });
    await screen.findByTestId("qr");
  });

  it("keeps the same reserved size after the code has loaded", async () => {
    const { container } = render(<LazyQRCodeSVG value="x" size={200} />);
    const wrapper = container.firstElementChild as HTMLElement;

    await screen.findByTestId("qr");

    expect(wrapper).toHaveStyle({ width: "200px", height: "200px" });
  });

  it("removes the placeholder once the code is shown", async () => {
    const { container } = render(<LazyQRCodeSVG value="x" size={200} />);

    await screen.findByTestId("qr");

    await waitFor(() => expect(container.querySelector(".animate-pulse")).not.toBeInTheDocument());
  });

  it("defaults the reserved size to 128 when neither size nor style is given", async () => {
    const { container } = render(<LazyQRCodeSVG value="x" />);

    expect(container.firstElementChild).toHaveStyle({ width: "128px", height: "128px" });
    await screen.findByTestId("qr");
  });
});
