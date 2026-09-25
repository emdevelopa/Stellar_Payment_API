import { describe, it, expect } from "vitest";
import {
  createInitialOnboardingState,
  onboardingReducer,
  type OnboardingState,
} from "./onboarding-reducer";

describe("onboardingReducer", () => {
  const base: OnboardingState = createInitialOnboardingState("step-1");

  it("creates initial state from a starting step", () => {
    expect(createInitialOnboardingState("step-1")).toEqual({
      currentStep: "step-1",
      optimisticStep: undefined,
      announcementText: "",
      isPending: false,
    });
  });

  it("marks an optimistic step as pending without changing the current step", () => {
    const next = onboardingReducer(base, { type: "OPTIMISTIC_STEP", payload: "step-2" });
    expect(next.optimisticStep).toBe("step-2");
    expect(next.isPending).toBe(true);
    expect(next.currentStep).toBe("step-1");
  });

  it("confirms an optimistic step", () => {
    const pending = onboardingReducer(base, { type: "OPTIMISTIC_STEP", payload: "step-2" });
    const next = onboardingReducer(pending, { type: "CONFIRM_STEP", payload: "step-2" });
    expect(next.currentStep).toBe("step-2");
    expect(next.optimisticStep).toBeUndefined();
    expect(next.isPending).toBe(false);
  });

  it("rolls back an optimistic step, keeping the confirmed current step", () => {
    const pending = onboardingReducer(base, { type: "OPTIMISTIC_STEP", payload: "step-2" });
    const next = onboardingReducer(pending, { type: "ROLLBACK_STEP" });
    expect(next.currentStep).toBe("step-1");
    expect(next.optimisticStep).toBeUndefined();
    expect(next.isPending).toBe(false);
  });

  it("sets the announcement text", () => {
    const next = onboardingReducer(base, { type: "SET_ANNOUNCEMENT", payload: "Step 2 of 3" });
    expect(next.announcementText).toBe("Step 2 of 3");
  });

  it("returns the same state for unknown actions", () => {
    // @ts-expect-error — exercising the default branch with an invalid action.
    expect(onboardingReducer(base, { type: "NOPE" })).toBe(base);
  });
});
