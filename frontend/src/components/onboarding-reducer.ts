/**
 * State logic for the Onboarding Progress Tracker.
 *
 * Extracted so the optimistic-update lifecycle is a pure, independently
 * testable unit.
 *
 * Bundle-optimisation notes:
 * - Pure TypeScript, zero runtime imports — tree-shakeable by any bundler.
 * - All selectors are standalone functions so consumers can import only what
 *   they need.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type LoadingState = "idle" | "loading" | "success" | "error";

export interface OnboardingState {
  readonly currentStep: string | undefined;
  readonly optimisticStep: string | undefined;
  readonly announcementText: string;
  readonly isPending: boolean;
  readonly loadingState: LoadingState;
  readonly errorMessage: string | null;
  readonly retryCount: number;
  /** Total step count — synced from props. */
  readonly totalSteps: number;
  /** Completed step count — synced from props. */
  readonly completedSteps: number;
}

export type OnboardingAction =
  | { type: "SET_CURRENT_STEP"; payload: string }
  | { type: "OPTIMISTIC_STEP"; payload: string }
  | { type: "CONFIRM_STEP"; payload: string }
  | { type: "ROLLBACK_STEP" }
  | { type: "SET_ANNOUNCEMENT"; payload: string }
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS" }
  | { type: "LOAD_ERROR"; payload: string }
  | { type: "SET_ERROR"; payload: string }
  | { type: "CLEAR_ERROR" }
  | { type: "RETRY" }
  /** Sync derived counts from the steps prop without remounting. */
  | { type: "SYNC_STEPS"; payload: { total: number; completed: number } };

// ── Factory ───────────────────────────────────────────────────────────────────

export function createInitialOnboardingState(
  currentStep?: string,
  totalSteps = 0,
  completedSteps = 0,
): OnboardingState {
  return {
    currentStep,
    optimisticStep: undefined,
    announcementText: "",
    isPending: false,
    loadingState: "idle",
    errorMessage: null,
    retryCount: 0,
    totalSteps,
    completedSteps,
  };
}

// ── Reducer ───────────────────────────────────────────────────────────────────

export function onboardingReducer(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState {
  switch (action.type) {
    case "SET_CURRENT_STEP":
      return { ...state, currentStep: action.payload, optimisticStep: undefined, isPending: false };

    case "OPTIMISTIC_STEP":
      return { ...state, optimisticStep: action.payload, isPending: true };

    case "CONFIRM_STEP":
      return { ...state, currentStep: action.payload, optimisticStep: undefined, isPending: false };

    case "ROLLBACK_STEP":
      return { ...state, optimisticStep: undefined, isPending: false };

    case "SET_ANNOUNCEMENT":
      return { ...state, announcementText: action.payload };

    case "LOAD_START":
      return { ...state, loadingState: "loading", errorMessage: null };

    case "LOAD_SUCCESS":
      return { ...state, loadingState: "success", errorMessage: null };

    case "LOAD_ERROR":
      return { ...state, loadingState: "error", errorMessage: action.payload, isPending: false };

    case "SET_ERROR":
      return { ...state, errorMessage: action.payload, loadingState: "error", isPending: false };

    case "CLEAR_ERROR":
      return { ...state, errorMessage: null, loadingState: "idle" };

    case "RETRY":
      return { ...state, loadingState: "loading", errorMessage: null, retryCount: state.retryCount + 1 };

    case "SYNC_STEPS":
      return { ...state, totalSteps: action.payload.total, completedSteps: action.payload.completed };

    default:
      return state;
  }
}

// ── Selectors ─────────────────────────────────────────────────────────────────

/** Active step id, accounting for optimistic state. */
export function selectEffectiveStep(state: OnboardingState): string | undefined {
  return state.optimisticStep ?? state.currentStep;
}

/**
 * Progress percentage clamped to [0, 100].
 * Reads totalSteps / completedSteps directly from state — no extra args needed.
 */
export function selectProgressPercent(state: OnboardingState): number {
  if (state.totalSteps === 0) return 0;
  return Math.min(100, Math.round((state.completedSteps / state.totalSteps) * 100));
}

export function selectIsLoading(state: OnboardingState): boolean {
  return state.loadingState === "loading";
}

export function selectHasError(state: OnboardingState): boolean {
  return state.loadingState === "error" && state.errorMessage !== null;
}
