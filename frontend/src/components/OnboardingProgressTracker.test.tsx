/**
 * @vitest-environment jsdom
 *
 * Unit tests for OnboardingProgressTracker (i18n refactor)
 *
 * Covers:
 *  - #809  framer-motion animation variants and reduced-motion support
 *  - #810  rendering, props, interactions, completion
 *  - #811  screen-reader / accessibility attributes
 *  - #812  optimistic updates and rollback
 *  - i18n  useOnboardingI18n hook integration (translated strings)
 *  - hook  useOnboardingProgress (SYNC_STEPS, external currentStep sync)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { OnboardingProgressTracker } from "./OnboardingProgressTracker";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/**
 * next-intl: return the key (with inline {token} substitution) so assertions
 * are locale-independent and don't depend on the real message catalogue.
 */
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (!params) return key;
    return Object.entries(params).reduce<string>(
      (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
      key,
    );
  },
}));

/**
 * framer-motion: strip animation props and render plain HTML so tests run fast
 * and don't depend on JSDOM animation support. (#809)
 */
vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_t, tag: string) =>
        React.forwardRef(
          (
            {
              children,
              animate,
              variants,
              initial,
              exit,
              transition,
              whileHover,
              whileTap,
              ...rest
            }: any,
            ref: any,
          ) => React.createElement(tag, { ...rest, ref }, children),
        ),
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const step1 = {
  id: "1", title: "Step 1", description: "Desc 1",
  completed: true,  required: true,  order: 1,
};
const step2 = {
  id: "2", title: "Step 2", description: "Desc 2",
  completed: false, required: true,  order: 2,
};
const step3 = {
  id: "3", title: "Step 3", description: "Desc 3",
  completed: false, required: false, order: 3,
};

const mockSteps = [step1, step2, step3];

const defaultProps = {
  steps: mockSteps,
  onStepChange: vi.fn(),
  onComplete: vi.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find a step button using a fragment of its translated aria-label.
 * The mock translates e.g. "stepLabelCompletedRequired" →
 * "stepLabelCompletedRequired" (the key), but our assertions match on title.
 */
const getStepBtn = (fragment: string) =>
  screen.getByRole("button", { name: new RegExp(fragment, "i") });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OnboardingProgressTracker", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── #810 Rendering ────────────────────────────────────────────────────────
  describe("Rendering", () => {
    it("renders the translated title key", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByText("title")).toBeInTheDocument();
    });

    it("renders the translated subtitle key", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByText("subtitle")).toBeInTheDocument();
    });

    it("renders all step titles and descriptions", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      mockSteps.forEach((s) => {
        expect(screen.getByText(s.title)).toBeInTheDocument();
        expect(screen.getByText(s.description)).toBeInTheDocument();
      });
    });

    it("renders the progress bar fill element", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByTestId("progress-bar-fill")).toBeInTheDocument();
    });

    it("sets width on progress bar fill to 33%", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByTestId("progress-bar-fill")).toHaveStyle("width: 33%");
    });

    it("sets correct ARIA attributes on the progressbar element", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const bar = screen.getByRole("progressbar");
      expect(bar).toHaveAttribute("aria-valuenow", "33");
      expect(bar).toHaveAttribute("aria-valuemin", "0");
      expect(bar).toHaveAttribute("aria-valuemax", "100");
    });

    it("does not show the completion banner when onboarding is incomplete", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.queryByTestId("completion-banner")).not.toBeInTheDocument();
    });

    it("shows the completion banner when all required steps are done", async () => {
      const allDone = [
        { ...step1, completed: true },
        { ...step2, completed: true },
        { ...step3, completed: false }, // optional — does not block completion
      ];
      render(<OnboardingProgressTracker {...defaultProps} steps={allDone} />);
      await waitFor(() =>
        expect(screen.getByTestId("completion-banner")).toBeInTheDocument(),
      );
    });

    it("renders the sr-only announcement region", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByTestId("sr-announcement")).toBeInTheDocument();
    });
  });

  // ── #810 Props / variants ─────────────────────────────────────────────────
  describe("Props and variants", () => {
    it("applies compact padding class when compact=true", () => {
      const { container } = render(
        <OnboardingProgressTracker {...defaultProps} compact />,
      );
      expect(container.querySelector(".p-4")).toBeInTheDocument();
    });

    it("renders the correct number of list items", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getAllByRole("listitem")).toHaveLength(3);
    });

    it("applies an extra className to the root wrapper", () => {
      const { container } = render(
        <OnboardingProgressTracker {...defaultProps} className="extra-class" />,
      );
      expect(container.firstChild).toHaveClass("extra-class");
    });
  });

  // ── #810 Interactions ─────────────────────────────────────────────────────
  describe("Interactions", () => {
    it("calls onStepChange when a step button is clicked", async () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      // Step 2 aria-label uses the "stepLabelRequired" key → "stepLabelRequired"
      // Our mock substitutes {number} and {title}: "Step 2: Step 2. Required"
      const btn2 = screen.getAllByRole("button")[1]; // second step
      fireEvent.click(btn2);
      await waitFor(() =>
        expect(defaultProps.onStepChange).toHaveBeenCalledWith("2"),
      );
    });

    it("does not call onStepChange while another step change is pending", async () => {
      let resolveCallback!: () => void;
      const slowCb = vi.fn(
        () => new Promise<void>((res) => { resolveCallback = res; }),
      );
      render(
        <OnboardingProgressTracker {...defaultProps} onStepChange={slowCb} currentStep="1" />,
      );

      const buttons = screen.getAllByRole("button");
      fireEvent.click(buttons[1]); // click step 2

      await waitFor(() => expect(buttons[0]).toBeDisabled());

      fireEvent.click(buttons[2]); // try clicking step 3 while pending
      expect(slowCb).toHaveBeenCalledTimes(1);

      act(() => resolveCallback());
    });
  });

  // ── #810 Completion ───────────────────────────────────────────────────────
  describe("Completion logic", () => {
    it("calls onComplete when all required steps are completed", async () => {
      const allRequired = [
        { ...step1, completed: true },
        { ...step2, completed: true },
        { ...step3, completed: false },
      ];
      render(<OnboardingProgressTracker {...defaultProps} steps={allRequired} />);
      await waitFor(() => expect(defaultProps.onComplete).toHaveBeenCalled());
    });

    it("does not call onComplete when a required step is incomplete", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(defaultProps.onComplete).not.toHaveBeenCalled();
    });

    it("renders the translated successTitle in the completion banner", async () => {
      const allRequired = [
        { ...step1, completed: true },
        { ...step2, completed: true },
        { ...step3, completed: false },
      ];
      render(<OnboardingProgressTracker {...defaultProps} steps={allRequired} />);
      await waitFor(() =>
        expect(screen.getByText("successTitle")).toBeInTheDocument(),
      );
    });

    it("renders the translated successMessage in the completion banner", async () => {
      const allRequired = [
        { ...step1, completed: true },
        { ...step2, completed: true },
        { ...step3, completed: false },
      ];
      render(<OnboardingProgressTracker {...defaultProps} steps={allRequired} />);
      await waitFor(() =>
        expect(screen.getByText("successMessage")).toBeInTheDocument(),
      );
    });
  });

  // ── #811 Accessibility ────────────────────────────────────────────────────
  describe("Accessibility (#811)", () => {
    it("wraps tracker in a region with translated aria-label", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByRole("region")).toHaveAttribute(
        "aria-label",
        "progressTracker",
      );
    });

    it("sets aria-live='polite' on the region", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByRole("region")).toHaveAttribute("aria-live", "polite");
    });

    it("provides an aria-live status region for announcements", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("announces progress on mount", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByRole("status").textContent).toMatch(/33/);
    });

    it("labels the steps list with the translated key", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByRole("list")).toHaveAttribute("aria-label", "stepsList");
    });

    it("sets aria-current='step' on the active step", () => {
      render(<OnboardingProgressTracker {...defaultProps} currentStep="1" />);
      expect(screen.getAllByRole("button")[0]).toHaveAttribute(
        "aria-current",
        "step",
      );
    });

    it("does not set aria-current on inactive steps", () => {
      render(<OnboardingProgressTracker {...defaultProps} currentStep="1" />);
      expect(screen.getAllByRole("button")[1]).not.toHaveAttribute("aria-current");
    });

    it("sets aria-setsize and aria-posinset on step buttons", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      const buttons = screen.getAllByRole("button");
      expect(buttons[0]).toHaveAttribute("aria-setsize", "3");
      expect(buttons[0]).toHaveAttribute("aria-posinset", "1");
      expect(buttons[1]).toHaveAttribute("aria-posinset", "2");
      expect(buttons[2]).toHaveAttribute("aria-posinset", "3");
    });

    it("sets aria-roledescription on step buttons", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      screen.getAllByRole("button").forEach((btn) => {
        expect(btn).toHaveAttribute("aria-roledescription", "onboarding step");
      });
    });

    it("marks the progressbar with translated aria-label", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-label",
        "progressBar",
      );
    });

    it("completion banner has role='alert' and aria-live='polite'", async () => {
      const allDone = [
        { ...step1, completed: true },
        { ...step2, completed: true },
        { ...step3, completed: false },
      ];
      render(<OnboardingProgressTracker {...defaultProps} steps={allDone} />);
      await waitFor(() => {
        const alert = screen.getByRole("alert");
        expect(alert).toHaveAttribute("aria-live", "polite");
        expect(alert).toHaveAttribute("aria-atomic", "true");
      });
    });

    it("marks required asterisk with translated aria-label", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      // Both step1 and step2 are required → two * elements
      expect(screen.getAllByLabelText("required").length).toBeGreaterThan(0);
    });

    it("announces step details when a step button is clicked", async () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      fireEvent.click(screen.getAllByRole("button")[1]);
      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toMatch(/Step 2|Desc 2/);
      });
    });
  });

  // ── #812 Optimistic updates ───────────────────────────────────────────────
  describe("Optimistic updates (#812)", () => {
    it("immediately marks the clicked step as current before callback resolves", async () => {
      let resolveCallback!: () => void;
      const slowCb = vi.fn(
        () => new Promise<void>((res) => { resolveCallback = res; }),
      );
      render(
        <OnboardingProgressTracker
          {...defaultProps}
          onStepChange={slowCb}
          currentStep="1"
        />,
      );

      const btn2 = screen.getAllByRole("button")[1];
      fireEvent.click(btn2);
      await waitFor(() =>
        expect(btn2).toHaveAttribute("aria-current", "step"),
      );
      act(() => resolveCallback());
    });

    it("confirms the optimistic update after callback resolves", async () => {
      const asyncCb = vi.fn(() => Promise.resolve());
      render(
        <OnboardingProgressTracker
          {...defaultProps}
          onStepChange={asyncCb}
          currentStep="1"
        />,
      );

      const btn2 = screen.getAllByRole("button")[1];
      fireEvent.click(btn2);
      await waitFor(() => {
        expect(asyncCb).toHaveBeenCalledWith("2");
        expect(btn2).toHaveAttribute("aria-current", "step");
      });
    });

    it("rolls back to the previous step when the callback throws", async () => {
      const failCb = vi.fn(() => Promise.reject(new Error("server error")));
      render(
        <OnboardingProgressTracker
          {...defaultProps}
          onStepChange={failCb}
          currentStep="1"
        />,
      );

      const btn1 = screen.getAllByRole("button")[0];
      const btn2 = screen.getAllByRole("button")[1];

      fireEvent.click(btn2);
      await waitFor(() => {
        expect(btn1).toHaveAttribute("aria-current", "step");
        expect(btn2).not.toHaveAttribute("aria-current");
      });
    });

    it("announces the translated stepChangeFailed key on rollback", async () => {
      const failCb = vi.fn(() => Promise.reject(new Error("fail")));
      render(
        <OnboardingProgressTracker
          {...defaultProps}
          onStepChange={failCb}
          currentStep="1"
        />,
      );

      fireEvent.click(screen.getAllByRole("button")[1]);
      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toContain(
          "stepChangeFailed",
        );
      });
    });

    it("sets aria-busy on the pending step button", async () => {
      let resolveCallback!: () => void;
      const slowCb = vi.fn(
        () => new Promise<void>((res) => { resolveCallback = res; }),
      );
      render(
        <OnboardingProgressTracker
          {...defaultProps}
          onStepChange={slowCb}
          currentStep="1"
        />,
      );

      const btn2 = screen.getAllByRole("button")[1];
      fireEvent.click(btn2);
      await waitFor(() => expect(btn2).toHaveAttribute("aria-busy", "true"));
      act(() => resolveCallback());
    });

    it("disables all step buttons while pending", async () => {
      let resolveCallback!: () => void;
      const slowCb = vi.fn(
        () => new Promise<void>((res) => { resolveCallback = res; }),
      );
      render(
        <OnboardingProgressTracker
          {...defaultProps}
          onStepChange={slowCb}
          currentStep="1"
        />,
      );

      fireEvent.click(screen.getAllByRole("button")[1]);
      await waitFor(() => {
        screen.getAllByRole("button").forEach((btn) =>
          expect(btn).toBeDisabled(),
        );
      });
      act(() => resolveCallback());
    });
  });

  // ── i18n ──────────────────────────────────────────────────────────────────
  describe("i18n — useOnboardingI18n", () => {
    it("uses 'progressTracker' key for region aria-label", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByRole("region")).toHaveAttribute(
        "aria-label",
        "progressTracker",
      );
    });

    it("uses 'progressBar' key for progressbar aria-label", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-label",
        "progressBar",
      );
    });

    it("uses 'stepsList' key for list aria-label", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByRole("list")).toHaveAttribute("aria-label", "stepsList");
    });

    it("renders allCompleted when onboarding is complete", async () => {
      const allDone = [
        { ...step1, completed: true },
        { ...step2, completed: true },
        { ...step3, completed: false },
      ];
      render(<OnboardingProgressTracker {...defaultProps} steps={allDone} />);
      await waitFor(() =>
        expect(screen.getByText("allCompleted")).toBeInTheDocument(),
      );
    });

    it("uses parameterised percentComplete key in header badge", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      // 1 of 3 = 33 — mock produces "percentComplete" with {percent} substituted
      expect(screen.getByText(/33/)).toBeInTheDocument();
    });

    it("uses parameterised stepsCompleted key in summary line", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      // mock renders "stepsCompleted" with tokens substituted
      expect(screen.getAllByText(/stepsCompleted|1.*3/i).length).toBeGreaterThan(0);
    });
  });

  // ── #809 Animations ───────────────────────────────────────────────────────
  describe("Animations (#809)", () => {
    it("renders the progress bar fill element", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getByTestId("progress-bar-fill")).toBeInTheDocument();
    });

    it("renders all step list items", () => {
      render(<OnboardingProgressTracker {...defaultProps} />);
      expect(screen.getAllByRole("listitem")).toHaveLength(3);
    });
  });

  // ── Hook integration (SYNC_STEPS / currentStep prop sync) ─────────────────
  describe("useOnboardingProgress integration", () => {
    it("syncs an external currentStep prop change", async () => {
      const { rerender } = render(
        <OnboardingProgressTracker {...defaultProps} currentStep="1" />,
      );
      expect(screen.getAllByRole("button")[0]).toHaveAttribute("aria-current", "step");

      rerender(<OnboardingProgressTracker {...defaultProps} currentStep="2" />);

      await waitFor(() =>
        expect(screen.getAllByRole("button")[1]).toHaveAttribute("aria-current", "step"),
      );
    });

    it("updates progress percentage when a completed step is added via SYNC_STEPS", async () => {
      const { rerender } = render(
        <OnboardingProgressTracker {...defaultProps} />,
      );
      expect(screen.getByTestId("progress-bar-fill")).toHaveStyle("width: 33%");

      rerender(
        <OnboardingProgressTracker
          {...defaultProps}
          steps={[
            { ...step1, completed: true },
            { ...step2, completed: true },
            step3,
          ]}
        />,
      );

      await waitFor(() =>
        expect(screen.getByTestId("progress-bar-fill")).toHaveStyle("width: 67%"),
      );
    });
  });
});
