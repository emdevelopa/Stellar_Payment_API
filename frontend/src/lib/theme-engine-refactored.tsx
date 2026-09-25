/**
 * Refactored Theme Engine with Modern Patterns
 * Issue #1148: Upgrade dependencies and refactor Dark Mode Theme Engine
 *
 * Improvements:
 * - Updated to latest React patterns (useTransition, useId)
 * - Improved TypeScript types with stricter inference
 * - Enhanced error boundaries and fallback handling
 * - Better separation of concerns
 * - Performance optimizations with startTransition
 * - Enhanced accessibility with ARIA live regions
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useTransition,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

// Type guards for runtime safety
const isThemeMode = (value: unknown): value is ThemeMode =>
  typeof value === "string" && ["light", "dark", "system"].includes(value);

const isResolvedTheme = (value: unknown): value is ResolvedTheme =>
  typeof value === "string" && ["light", "dark"].includes(value);

// Utility functions
const systemPrefersDark = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

export const resolveTheme = (
  mode: ThemeMode,
  forced?: ResolvedTheme,
): ResolvedTheme =>
  forced ??
  (mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode);

const applyThemeToDOM = (theme: ResolvedTheme): void => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;

  // Update meta theme-color for mobile browsers
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", theme === "dark" ? "#0A0A0A" : "#FFFFFF");
  }
};

// Enhanced context interface
interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  isMounted: boolean;
  isPending: boolean;
  error: Error | null;
  ariaLiveMessage: string;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Enhanced state with error handling
interface ThemeState {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  isMounted: boolean;
  error: Error | null;
}

// Action types with better TypeScript inference
type ThemeAction =
  | {
      type: "MOUNT";
      payload: { theme: ThemeMode; resolvedTheme: ResolvedTheme };
    }
  | {
      type: "SET_THEME";
      payload: { theme: ThemeMode; resolvedTheme: ResolvedTheme };
    }
  | { type: "UPDATE_RESOLVED"; payload: { resolvedTheme: ResolvedTheme } }
  | { type: "SET_ERROR"; payload: { error: Error } }
  | { type: "CLEAR_ERROR" };

// Reducer with comprehensive error handling
const themeReducer = (state: ThemeState, action: ThemeAction): ThemeState => {
  switch (action.type) {
    case "MOUNT":
      return {
        ...state,
        isMounted: true,
        theme: action.payload.theme,
        resolvedTheme: action.payload.resolvedTheme,
        error: null,
      };
    case "SET_THEME":
      return {
        ...state,
        theme: action.payload.theme,
        resolvedTheme: action.payload.resolvedTheme,
        error: null,
      };
    case "UPDATE_RESOLVED":
      return {
        ...state,
        resolvedTheme: action.payload.resolvedTheme,
      };
    case "SET_ERROR":
      return {
        ...state,
        error: action.payload.error,
      };
    case "CLEAR_ERROR":
      return {
        ...state,
        error: null,
      };
    default:
      return state;
  }
};

// Enhanced provider props with validation
interface ThemeProviderProps {
  readonly children: ReactNode;
  readonly defaultTheme?: ThemeMode;
  readonly storageKey?: string;
  readonly enableSystem?: boolean;
  readonly forcedTheme?: ResolvedTheme;
  readonly onThemeChange?: (theme: ThemeMode, resolved: ResolvedTheme) => void;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "merchant-theme-preference",
  enableSystem = true,
  forcedTheme,
  onThemeChange,
}: ThemeProviderProps) {
  const liveRegionId = useId();
  const [isPending, startTransition] = useTransition();

  const [state, dispatch] = useReducer(themeReducer, {
    theme: defaultTheme,
    resolvedTheme: resolveTheme(defaultTheme, forcedTheme),
    isMounted: false,
    error: null,
  });

  const themeRef = useRef(state.theme);
  const onThemeChangeRef = useRef(onThemeChange);

  themeRef.current = state.theme;
  onThemeChangeRef.current = onThemeChange;

  // Memoized resolver with forced theme support
  const resolver = useCallback(
    (mode: ThemeMode): ResolvedTheme => resolveTheme(mode, forcedTheme),
    [forcedTheme],
  );

  // Enhanced setTheme with transitions and error handling
  const setTheme = useCallback(
    (newTheme: ThemeMode) => {
      if (!isThemeMode(newTheme)) {
        dispatch({
          type: "SET_ERROR",
          payload: { error: new Error(`Invalid theme: ${newTheme}`) },
        });
        return;
      }

      const resolved = resolver(newTheme);

      startTransition(() => {
        dispatch({
          type: "SET_THEME",
          payload: { theme: newTheme, resolvedTheme: resolved },
        });
        applyThemeToDOM(resolved);

        try {
          if (typeof localStorage !== "undefined") {
            localStorage.setItem(storageKey, newTheme);
          }
          onThemeChangeRef.current?.(newTheme, resolved);
        } catch (err) {
          const error =
            err instanceof Error ? err : new Error("Failed to persist theme");
          dispatch({ type: "SET_ERROR", payload: { error } });
          console.error("Theme persistence error:", error);
        }
      });
    },
    [resolver, storageKey],
  );

  // Enhanced toggle with cycle support
  const toggleTheme = useCallback(() => {
    const themes: ThemeMode[] = enableSystem
      ? ["light", "dark", "system"]
      : ["light", "dark"];
    const currentIndex = themes.indexOf(themeRef.current);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  }, [setTheme, enableSystem]);

  // Mount effect with validation
  useEffect(() => {
    try {
      const stored =
        typeof localStorage !== "undefined"
          ? localStorage.getItem(storageKey)
          : null;

      const validatedStored = stored && isThemeMode(stored) ? stored : null;
      const initialTheme = validatedStored ?? defaultTheme;
      const resolved = resolver(initialTheme);

      dispatch({
        type: "MOUNT",
        payload: { theme: initialTheme, resolvedTheme: resolved },
      });
      applyThemeToDOM(resolved);
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("Theme initialization failed");
      dispatch({ type: "SET_ERROR", payload: { error } });
      console.error("Theme mount error:", error);
    }
  }, [storageKey, defaultTheme, resolver]);

  // System preference listener with enhanced error handling
  useEffect(() => {
    if (!state.isMounted || forcedTheme || !enableSystem) return;

    try {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

      const handler = (e: MediaQueryListEvent | MediaQueryList) => {
        if (themeRef.current === "system") {
          const resolved: ResolvedTheme = e.matches ? "dark" : "light";
          dispatch({
            type: "UPDATE_RESOLVED",
            payload: { resolvedTheme: resolved },
          });
          applyThemeToDOM(resolved);
          onThemeChangeRef.current?.(themeRef.current, resolved);
        }
      };

      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    } catch (err) {
      console.error("System theme listener error:", err);
    }
  }, [state.isMounted, forcedTheme, enableSystem]);

  // Generate ARIA live message
  const ariaLiveMessage = useMemo(() => {
    if (!state.isMounted) return "Theme is loading";
    if (state.error) return `Theme error: ${state.error.message}`;
    if (isPending) return "Changing theme";

    const themeDesc =
      state.theme === "system"
        ? `system (${state.resolvedTheme})`
        : state.theme;
    return `Current theme: ${themeDesc}`;
  }, [state, isPending]);

  // Memoized context value
  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: state.theme,
      resolvedTheme: state.resolvedTheme,
      setTheme,
      toggleTheme,
      isMounted: state.isMounted,
      isPending,
      error: state.error,
      ariaLiveMessage,
    }),
    [state, setTheme, toggleTheme, isPending, ariaLiveMessage],
  );

  return (
    <ThemeContext.Provider value={value}>
      {/* ARIA live region for screen readers */}
      <div
        id={liveRegionId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {ariaLiveMessage}
      </div>
      {children}
    </ThemeContext.Provider>
  );
}

// Enhanced hooks with better type inference
export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};

export const useThemeState = () => {
  const { theme, resolvedTheme, isMounted, isPending, error } = useTheme();
  return {
    theme,
    resolvedTheme,
    isMounted,
    isPending,
    error,
    isDark: resolvedTheme === "dark",
    isLight: resolvedTheme === "light",
    isSystem: theme === "system",
    hasError: error !== null,
  } as const;
};

export const useThemeActions = () => {
  const { setTheme, toggleTheme } = useTheme();
  return { setTheme, toggleTheme } as const;
};

// Utility hook for theme-dependent values
export const useThemedValue = <T,>(lightValue: T, darkValue: T): T => {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? darkValue : lightValue;
};

// Hook for theme-aware CSS classes
export const useThemeClasses = () => {
  const { resolvedTheme, theme, isMounted } = useTheme();
  return {
    theme: isMounted ? theme : undefined,
    resolved: isMounted ? resolvedTheme : undefined,
    classes: isMounted
      ? {
          root: resolvedTheme,
          isDark: resolvedTheme === "dark",
          isLight: resolvedTheme === "light",
          isSystem: theme === "system",
        }
      : null,
  } as const;
};
