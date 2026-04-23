import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Button } from "./Button";

describe("Button Component - Mobile Responsiveness", () => {
  describe("Rendering", () => {
    it("renders primary button correctly", () => {
      render(<Button variant="primary">Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveClass("bg-mint");
    });

    it("renders secondary button correctly", () => {
      render(<Button variant="secondary">Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveClass("border-white/10");
    });

    it("renders with default primary variant when no variant specified", () => {
      render(<Button>Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("bg-mint");
    });
  });

  describe("Mobile Responsiveness", () => {
    it("has responsive padding classes", () => {
      render(<Button>Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button.className).toMatch(/px-4\s+sm:px-6/);
    });

    it("has responsive height classes", () => {
      render(<Button>Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button.className).toMatch(/h-11\s+sm:h-12/);
    });

    it("has responsive text size classes", () => {
      render(<Button>Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button.className).toMatch(/text-sm\s+sm:text-base/);
    });

    it("has minimum touch target height", () => {
      render(<Button>Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("min-h-[44px]");
    });

    it("has touch-manipulation CSS property", () => {
      render(<Button>Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("touch-manipulation");
    });

    it("has active scale effect for touch feedback", () => {
      render(<Button variant="primary">Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("active:scale-[0.98]");
    });
  });

  describe("Loading State", () => {
    it("shows loading spinner when isLoading is true", () => {
      render(<Button isLoading>Click me</Button>);
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it("hides children when loading", () => {
      render(<Button isLoading>Click me</Button>);
      expect(screen.queryByText("Click me")).not.toBeInTheDocument();
    });

    it("disables button when loading", () => {
      render(<Button isLoading>Click me</Button>);
      const button = screen.getByRole("button");
      expect(button).toBeDisabled();
    });

    it("shows correct spinner color for primary variant", () => {
      const { container } = render(
        <Button variant="primary" isLoading>
          Click me
        </Button>,
      );
      const spinner = container.querySelector(".text-black");
      expect(spinner).toBeInTheDocument();
    });

    it("shows correct spinner color for secondary variant", () => {
      const { container } = render(
        <Button variant="secondary" isLoading>
          Click me
        </Button>,
      );
      const spinner = container.querySelector(".text-mint");
      expect(spinner).toBeInTheDocument();
    });
  });

  describe("Disabled State", () => {
    it("disables button when disabled prop is true", () => {
      render(<Button disabled>Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toBeDisabled();
    });

    it("has disabled styling", () => {
      render(<Button disabled>Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("disabled:cursor-not-allowed");
      expect(button).toHaveClass("disabled:opacity-50");
    });

    it("does not trigger onClick when disabled", () => {
      const handleClick = jest.fn();
      render(
        <Button disabled onClick={handleClick}>
          Click me
        </Button>,
      );
      const button = screen.getByRole("button", { name: /click me/i });
      fireEvent.click(button);
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe("Interactions", () => {
    it("calls onClick handler when clicked", () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      fireEvent.click(button);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("does not call onClick when loading", () => {
      const handleClick = jest.fn();
      render(
        <Button isLoading onClick={handleClick}>
          Click me
        </Button>,
      );
      const button = screen.getByRole("button");
      fireEvent.click(button);
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe("Accessibility", () => {
    it("has proper focus-visible styles", () => {
      render(<Button>Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("focus-visible:ring-2");
      expect(button).toHaveClass("focus-visible:ring-mint");
    });

    it("forwards ref correctly", () => {
      const ref = React.createRef<HTMLButtonElement>();
      render(<Button ref={ref}>Click me</Button>);
      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    });

    it("accepts custom className", () => {
      render(<Button className="custom-class">Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("custom-class");
    });

    it("spreads additional props to button element", () => {
      render(
        <Button data-testid="custom-button" aria-label="Custom label">
          Click me
        </Button>,
      );
      const button = screen.getByTestId("custom-button");
      expect(button).toHaveAttribute("aria-label", "Custom label");
    });
  });

  describe("Visual Feedback", () => {
    it("shows glow effect for primary variant", () => {
      const { container } = render(<Button variant="primary">Click me</Button>);
      const glowDiv = container.querySelector(".bg-mint\\/20");
      expect(glowDiv).toBeInTheDocument();
    });

    it("does not show glow effect for secondary variant", () => {
      const { container } = render(
        <Button variant="secondary">Click me</Button>,
      );
      const glowDiv = container.querySelector(".bg-mint\\/20");
      expect(glowDiv).not.toBeInTheDocument();
    });

    it("has hover styles for primary variant", () => {
      render(<Button variant="primary">Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      expect(button).toHaveClass("hover:bg-glow");
    });

    it("has hover styles for secondary variant", () => {
      render(<Button variant="secondary">Click me</Button>);
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
      const { rerender } = render(<Button>Click me</Button>);
      const button = screen.getByRole("button", { name: /click me/i });
      const firstRender = button;

      rerender(<Button>Click me</Button>);
      const secondRender = screen.getByRole("button", { name: /click me/i });

      expect(firstRender).toBe(secondRender);
    });
  });
});
