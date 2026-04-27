import React from "react";
import { vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Button } from "./Button";

function renderButton(
  props: React.ComponentProps<typeof Button> = {},
  children = "Click me",
) {
  return render(React.createElement(Button, props, children));
}

describe("Button Component - Mobile Responsiveness", () => {
  describe("Rendering", () => {
    it("renders primary button correctly", () => {
      renderButton({ variant: "primary" });
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveClass("bg-mint");
    });

    it("renders secondary button correctly", () => {
      renderButton({ variant: "secondary" });
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveClass("border-white/10");
    });

    it("renders with default primary variant when no variant specified", () => {
      renderButton();
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("bg-mint");
    });
  });

  describe("Mobile Responsiveness", () => {
    it("has responsive padding classes", () => {
      renderButton();
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button.className).toMatch(/px-4\s+sm:px-6/);
    });

    it("has responsive height classes", () => {
      renderButton();
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button.className).toMatch(/h-11\s+sm:h-12/);
    });

    it("has responsive text size classes", () => {
      renderButton();
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button.className).toMatch(/text-sm\s+sm:text-base/);
    });

    it("has minimum touch target height", () => {
      renderButton();
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("min-h-[44px]");
    });

    it("has touch-manipulation CSS property", () => {
      renderButton();
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("touch-manipulation");
    });

    it("has active scale effect for touch feedback", () => {
      renderButton({ variant: "primary" });
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("active:scale-[0.98]");
    });
  });

  describe("Loading State", () => {
    it("shows loading spinner when isLoading is true", () => {
      renderButton({ isLoading: true });
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it("hides children when loading", () => {
      renderButton({ isLoading: true });
      expect(screen.queryByText("Click me")).not.toBeInTheDocument();
    });

    it("disables button when loading", () => {
      renderButton({ isLoading: true });
      const button = screen.getByRole("button");
      expect(button).toBeDisabled();
    });

    it("shows correct spinner color for primary variant", () => {
      const { container } = renderButton({ variant: "primary", isLoading: true });
      const spinner = container.querySelector(".text-black");
      expect(spinner).toBeInTheDocument();
    });

    it("shows correct spinner color for secondary variant", () => {
      const { container } = renderButton({ variant: "secondary", isLoading: true });
      const spinner = container.querySelector(".text-mint");
      expect(spinner).toBeInTheDocument();
    });
  });

  describe("Disabled State", () => {
    it("disables button when disabled prop is true", () => {
      renderButton({ disabled: true });
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toBeDisabled();
    });

    it("has disabled styling", () => {
      renderButton({ disabled: true });
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("disabled:cursor-not-allowed");
      expect(button).toHaveClass("disabled:opacity-50");
    });

    it("does not trigger onClick when disabled", () => {
      const handleClick = vi.fn();
      renderButton({ disabled: true, onClick: handleClick });
      const button = screen.getByRole("button", { name: /click me/i });
      fireEvent.click(button);
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe("Interactions", () => {
    it("calls onClick handler when clicked", () => {
      const handleClick = vi.fn();
      renderButton({ onClick: handleClick });
      const button = screen.getByRole("button", { name: /click me/i });
      fireEvent.click(button);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("does not call onClick when loading", () => {
      const handleClick = vi.fn();
      renderButton({ isLoading: true, onClick: handleClick });
      const button = screen.getByRole("button");
      fireEvent.click(button);
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe("Accessibility", () => {
    it("has proper focus-visible styles", () => {
      renderButton();
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("focus-visible:ring-2");
      expect(button).toHaveClass("focus-visible:ring-mint");
    });

    it("forwards ref correctly", () => {
      const ref = React.createRef<HTMLButtonElement>();
      renderButton({ ref });
      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    });

    it("accepts custom className", () => {
      renderButton({ className: "custom-class" });
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("custom-class");
    });

    it("spreads additional props to button element", () => {
      renderButton({ title: "Custom title", "aria-label": "Custom label" });
      const button = screen.getByTitle("Custom title");
      expect(button).toHaveAttribute("aria-label", "Custom label");
    });
  });

  describe("Visual Feedback", () => {
    it("shows glow effect for primary variant", () => {
      const { container } = renderButton({ variant: "primary" });
      const glowDiv = container.querySelector(".bg-mint\\/20");
      expect(glowDiv).toBeInTheDocument();
    });

    it("does not show glow effect for secondary variant", () => {
      const { container } = renderButton({ variant: "secondary" });
      const glowDiv = container.querySelector(".bg-mint\\/20");
      expect(glowDiv).not.toBeInTheDocument();
    });

    it("has hover styles for primary variant", () => {
      renderButton({ variant: "primary" });
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("hover:bg-glow");
    });

    it("has hover styles for secondary variant", () => {
      renderButton({ variant: "secondary" });
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("hover:border-white/20");
      expect(button).toHaveClass("hover:text-white");
    });
  });

  describe("Performance", () => {
    it("uses React.memo for optimization", () => {
      expect(Button.displayName).toBe("Button");
    });

    it("does not re-render unnecessarily", () => {
      const { rerender } = renderButton();
      const button = screen.getByRole("button", { name: /click me/i });
      const firstRender = button;

      rerender(React.createElement(Button, null, "Click me"));
      const secondRender = screen.getByRole("button", { name: /click me/i });

      expect(firstRender).toBe(secondRender);
    });
  });
});
