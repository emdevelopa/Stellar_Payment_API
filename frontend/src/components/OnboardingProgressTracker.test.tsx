/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { OnboardingProgressTracker } from "./OnboardingProgressTracker";
import React from "react";

// Mock the dependencies
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: React.forwardRef(({ children, ...props }: any, ref) => <div {...props} ref={ref}>{children}</div>),
    button: React.forwardRef(({ children, ...props }: any, ref) => <button {...props} ref={ref}>{children}</button>),
    span: React.forwardRef(({ children, ...props }: any, ref) => <span {...props} ref={ref}>{children}</span>),
    svg: React.forwardRef(({ children, ...props }: any, ref) => <svg {...props} ref={ref}>{children}</svg>),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

/**
 * Unit tests for OnboardingProgressTracker component
 */
describe("OnboardingProgressTracker", () => {
  const mockSteps = [
    {
      id: "1",
      title: "Step 1",
      description: "Description 1",
      completed: true,
      required: true,
      order: 1,
    },
    {
      id: "2",
      title: "Step 2",
      description: "Description 2",
      completed: false,
      required: true,
      order: 2,
    },
    {
      id: "3",
      title: "Step 3",
      description: "Description 3",
      completed: false,
      required: false,
      order: 3,
    },
  ];

  const defaultProps = {
    steps: mockSteps,
    onStepChange: vi.fn(),
    onComplete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("should render the component with correct title", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByText("onboarding.title")).toBeInTheDocument();
    });

    it("should render all steps with correct titles and descriptions", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      
      mockSteps.forEach(step => {
        expect(screen.getByText(step.title)).toBeInTheDocument();
        expect(screen.getByText(step.description)).toBeInTheDocument();
      });
    });

    it("should show correct progress percentage", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      // 1 out of 3 steps completed = 33%
      expect(screen.getByText("33%")).toBeInTheDocument();
    });

    it("should show progress bar with correct width", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const progressBar = screen.getByLabelText("onboarding.progressBar");
      expect(progressBar).toHaveStyle("width: 33%");
    });
  });

  describe("Interactions", () => {
    it("should call onStepChange when a step is clicked", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      
      // The aria-label is constructed as: `Step ${index + 1}: ${step.title}${step.completed ? ". Completed" : ""}${step.required ? ". Required" : ""}`
      const secondStepButton = screen.getByLabelText(/Step 2: Step 2. Required/i);
      fireEvent.click(secondStepButton);
      
      expect(defaultProps.onStepChange).toHaveBeenCalledWith("2");
    });

    it("should update announcement text when a step is clicked", async () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      
      const secondStepButton = screen.getByLabelText(/Step 2: Step 2. Required/i);
      fireEvent.click(secondStepButton);
      
      const announcementArea = screen.getByRole("status");
      // The announcement text is: `${t("onboarding.stepProgress") || "Step"} ${step.order}: ${step.title}. ${step.description}`
      expect(announcementArea.textContent).toContain("Step 2: Step 2. Description 2");
    });
  });

  describe("Completion Logic", () => {
    it("should call onComplete when all required steps are completed", async () => {
      const completedRequiredSteps = [
        { ...mockSteps[0], completed: true },
        { ...mockSteps[1], completed: true },
        { ...mockSteps[2], completed: false }, // Not required
      ];

      render(<OnboardingProgressTracker {...defaultProps} steps={completedRequiredSteps} />);
      
      await waitFor(() => {
        expect(defaultProps.onComplete).toHaveBeenCalled();
      });
      expect(screen.getByText("onboarding.allCompleted")).toBeInTheDocument();
      expect(screen.getByText("onboarding.successTitle")).toBeInTheDocument();
    });

    it("should not call onComplete if a required step is missing", () => {
      const incompleteRequiredSteps = [
        { ...mockSteps[0], completed: true },
        { ...mockSteps[1], completed: false }, // Required
        { ...mockSteps[2], completed: true }, // Not required
      ];

      render(<OnboardingProgressTracker {...defaultProps} steps={incompleteRequiredSteps} />);
      
      expect(defaultProps.onComplete).not.toHaveBeenCalled();
      expect(screen.queryByText("onboarding.successTitle")).not.toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    it("should have proper ARIA attributes for the container", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("aria-label", "onboarding.progressTracker");
      expect(region).toHaveAttribute("aria-live", "polite");
    });

    it("should have proper ARIA attributes for the steps list", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const list = screen.getByRole("list");
      expect(list).toHaveAttribute("aria-label", "onboarding.stepsList");
    });

    it("should mark the current step with aria-current='step'", () => {
      // By default currentStep is steps[0].id if not provided
      render(<OnboardingProgressTracker {...defaultProps} currentStep="1" />);
      const firstStepButton = screen.getByLabelText(/Step 1: Step 1. Completed. Required/i);
      expect(firstStepButton).toHaveAttribute("aria-current", "step");
    });
  });

  describe("Props and Variants", () => {
    it("should not show step numbers when showStepNumbers is false", () => {
      render(<OnboardingProgressTracker {...defaultProps} showStepNumbers={false} />);
      expect(screen.queryByText("1")).not.toBeInTheDocument();
      expect(screen.queryByText("2")).not.toBeInTheDocument();
    });

    it("should apply compact padding when compact prop is true", () => {
      const { container } = render(<OnboardingProgressTracker {...defaultProps} compact={true} />);
      const innerContainer = container.querySelector(".p-4");
      expect(innerContainer).toBeInTheDocument();
    });

    it("should apply horizontal layout classes when orientation is horizontal", () => {
      render(<OnboardingProgressTracker {...defaultProps} orientation="horizontal" />);
      const list = screen.getByRole("list");
      expect(list).toHaveClass("flex");
      expect(list).toHaveClass("gap-4");
    });
  });
});
