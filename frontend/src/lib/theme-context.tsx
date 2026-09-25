"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

function systemPrefersDark(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    !!globalThis.window &&
    globalThis.window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(mode: ThemeMode, forced?: ResolvedTheme): ResolvedTheme {
  if (forced) return forced;
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

function applyThemeToDocument(resolved: ResolvedTheme): void {
  if (typeof globalThis === "undefined" || !globalThis.document) return;
  globalThis.document.documentElement.classList.remove("light", "dark");
  globalThis.document.documentElement.classList.add(resolved);
  const metaThemeColor = globalThis.document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", resolved === "dark" ? "#0A0A0A" : "#FFFFFF");
  }
}

interface ThemeContextType {
  theme: ThemeMode | undefined;
  resolvedTheme: ResolvedTheme | undefined;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  isMounted: boolean;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// --- Reducer ---

interface ThemeState {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme | undefined;
  isMounted: boolean;
  isLoading: boolean;
  error: string | null;
}

type ThemeAction =
  | { type: "MOUNT"; theme: ThemeMode; resolvedTheme: ResolvedTheme }
  | { type: "SET_THEME"; theme: ThemeMode; resolvedTheme: ResolvedTheme }
  | { type: "SET_RESOLVED"; resolvedTheme: ResolvedTheme }
  | { type: "SET_ERROR"; error: string; theme: ThemeMode; resolvedTheme: ResolvedTheme | undefined }
  | { type: "CLEAR_ERROR" };

function themeReducer(state: ThemeState, action: ThemeAction): ThemeState {
  switch (action.type) {
    case "MOUNT":
      return {
        ...state,
        isMounted: true,
        isLoading: false,
        theme: action.theme,
        resolvedTheme: action.resolvedTheme,
      };
    case "SET_THEME":
      return {
        ...state,
        theme: action.theme,
        resolvedTheme: action.resolvedTheme,
        error: null,
      };
    case "SET_RESOLVED":
      return { ...state, resolvedTheme: action.resolvedTheme };
    case "SET_ERROR":
      return {
        ...state,
        error: action.error,
        theme: action.theme,
        resolvedTheme: action.resolvedTheme,
      };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    default:
      return state;
  }
}

// --- Provider ---

interface ThemeProviderProps {
  readonly children: ReactNode;
  readonly defaultTheme?: ThemeMode;
  readonly storageKey?: string;
  readonly enableSystem?: boolean;
  readonly forcedTheme?: ResolvedTheme;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "merchant-theme-preference",
  enableSystem = true,
  forcedTheme,
}: ThemeProviderProps) {
  const [state, dispatch] = useReducer(themeReducer, {
    theme: defaultTheme,
    resolvedTheme: undefined,
    isMounted: false,
    isLoading: true,
    error: null,
  });

  // Ref so media query listener always reads the latest theme without stale closure
  const themeRef = useRef<ThemeMode>(defaultTheme);
  themeRef.current = state.theme;

  const resolveThemeMode = useCallback(
    (themeMode: ThemeMode): ResolvedTheme => {
      if (forcedTheme) return forcedTheme;
      if (themeMode !== "system") return themeMode;
      return systemPrefersDark() ? "dark" : "light";
    },
    [forcedTheme]
  );

  const resolvedRef = useRef<ResolvedTheme | undefined>(state.resolvedTheme);
  resolvedRef.current = state.resolvedTheme;

  const clearError = useCallback(() => {
    dispatch({ type: "CLEAR_ERROR" });
  }, []);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    const previousTheme = themeRef.current;
    const previousResolved = resolvedRef.current;

    const resolved = resolveThemeMode(newTheme);
    dispatch({ type: "SET_THEME", theme: newTheme, resolvedTheme: resolved });
    applyThemeToDocument(resolved);

    try {
      if (typeof globalThis !== "undefined" && globalThis.window) {
        globalThis.localStorage.setItem(storageKey, newTheme);
      }
    } catch (err) {
      if (previousResolved) {
        applyThemeToDocument(previousResolved);
      }
      const errorMessage = err instanceof Error ? err.message : "Failed to set theme";
      dispatch({
        type: "SET_ERROR",
        error: errorMessage,
        theme: previousTheme,
        resolvedTheme: previousResolved,
      });
      console.error("Theme setting error:", err);
    }
  }, [resolveThemeMode, storageKey]);

  const toggleTheme = useCallback(() => {
    const themes: ThemeMode[] = ["light", "dark", "system"];
    const currentIndex = themeRef.current ? themes.indexOf(themeRef.current) : 0;
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  }, [setTheme]);

  const applyTheme = useCallback((mode: ThemeMode) => {
    try {
      const resolved = resolveThemeMode(mode);
      dispatch({ type: "SET_RESOLVED", resolvedTheme: resolved });
      applyThemeToDocument(resolved);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to apply theme";
      dispatch({
        type: "SET_ERROR",
        error: errorMessage,
        theme: themeRef.current,
        resolvedTheme: resolvedRef.current,
      });
      console.error("Theme apply error:", err);
    }
  }, [resolveThemeMode]);

  // Mount effect — runs once to read stored preference and attach system listener
  useEffect(() => {
    const storedTheme = typeof globalThis !== "undefined" && globalThis.localStorage
      ? (globalThis.localStorage.getItem(storageKey) as ThemeMode | null)
      : null;
    const initialTheme = storedTheme || defaultTheme;
    const initialResolved = resolveThemeMode(initialTheme);

    dispatch({
      type: "MOUNT",
      theme: initialTheme,
      resolvedTheme: initialResolved,
    });
    applyThemeToDocument(initialResolved);
  }, [storageKey, defaultTheme, resolveThemeMode]);

  useEffect(() => {
    if (!enableSystem || forcedTheme || !state.isMounted) return;

    const mediaQuery = globalThis.window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (themeRef.current === "system") {
        applyTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [enableSystem, forcedTheme, state.isMounted, applyTheme]);

  const value: ThemeContextType = useMemo(() => ({
    theme: state.theme,
    resolvedTheme: state.resolvedTheme,
    setTheme,
    toggleTheme,
    isMounted: state.isMounted,
    isLoading: state.isLoading,
    error: state.error,
    clearError,
  }), [state, setTheme, toggleTheme, clearError]);

  return (
    <ThemeContext.Provider value={value}>
      <NextThemesProvider
        attribute="class"
        defaultTheme={defaultTheme}
        enableSystem={enableSystem}
        storageKey={storageKey}
        forcedTheme={forcedTheme}
      >
        {children}
      </NextThemesProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

export function useThemeState() {
  const { theme, resolvedTheme, isMounted, isLoading, error } = useTheme();
  return {
    theme,
    resolvedTheme,
    isMounted,
    isLoading,
    error,
    isDark: resolvedTheme === "dark",
    isLight: resolvedTheme === "light",
    isSystem: theme === "system",
  };
}

export function useThemeActions() {
  const { setTheme, toggleTheme, clearError } = useTheme();
  return { setTheme, toggleTheme, clearError };
}
