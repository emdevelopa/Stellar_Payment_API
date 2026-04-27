"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode, useMemo } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

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
  const [theme, setThemeState] = useState<ThemeMode | undefined>(defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme | undefined>(undefined);
  const [isMounted, setIsMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    const previousTheme = theme;
    const previousResolved = resolvedTheme;

    try {
      setThemeState(newTheme);
      
      if (typeof globalThis !== "undefined" && globalThis.window) {
        globalThis.localStorage.setItem(storageKey, newTheme);
        
        const mediaQuery = globalThis.window.matchMedia("(prefers-color-scheme: dark)");
        const systemTheme = mediaQuery.matches ? "dark" : "light";
        const resolved = newTheme === "system" ? systemTheme : newTheme;
        
        setResolvedTheme(resolved);
        
        globalThis.document.documentElement.classList.remove("light", "dark");
        globalThis.document.documentElement.classList.add(resolved);
        
        const metaThemeColor = globalThis.document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
          metaThemeColor.setAttribute("content", resolved === "dark" ? "#0A0A0A" : "#FFFFFF");
        }
      }
      
      setError(null);
    } catch (err) {
      // Revert optimistic update
      setThemeState(previousTheme !== undefined ? previousTheme : defaultTheme);
      if (previousResolved) {
        setResolvedTheme(previousResolved);
        if (typeof globalThis !== "undefined" && globalThis.window) {
          globalThis.document.documentElement.classList.remove("light", "dark");
          globalThis.document.documentElement.classList.add(previousResolved);
        }
      }
      
      const errorMessage = err instanceof Error ? err.message : "Failed to set theme";
      setError(errorMessage);
      console.error("Theme setting error:", err);
    }
  }, [storageKey, theme, resolvedTheme, defaultTheme]);

  const toggleTheme = useCallback(() => {
    const themes: ThemeMode[] = ["light", "dark", "system"];
    const currentIndex = theme ? themes.indexOf(theme) : 0;
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  }, [theme, setTheme]);

  useEffect(() => {
    setIsMounted(true);
    
    const storedTheme = typeof globalThis !== "undefined" && globalThis.localStorage 
      ? (globalThis.localStorage.getItem(storageKey) as ThemeMode | null)
      : null;
    const initialTheme = storedTheme || defaultTheme;
    
    setThemeState(initialTheme);
    
    const updateResolvedTheme = () => {
      try {
        const mediaQuery = globalThis.window.matchMedia("(prefers-color-scheme: dark)");
        const systemTheme = mediaQuery.matches ? "dark" : "light";
        const resolved = forcedTheme || (initialTheme === "system" ? systemTheme : initialTheme);
        
        setResolvedTheme(resolved);
        globalThis.document.documentElement.classList.remove("light", "dark");
        globalThis.document.documentElement.classList.add(resolved);
        
        const metaThemeColor = globalThis.document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
          metaThemeColor.setAttribute("content", resolved === "dark" ? "#0A0A0A" : "#FFFFFF");
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to initialize theme";
        setError(errorMessage);
        console.error("Theme initialization error:", err);
      } finally {
        setIsLoading(false);
      }
    };

    updateResolvedTheme();
    
    if (enableSystem && !forcedTheme) {
      const mediaQuery = globalThis.window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => {
        if (theme === "system") {
          updateResolvedTheme();
        }
      };
      
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
  }, [storageKey, defaultTheme, enableSystem, forcedTheme, theme]);

  const value: ThemeContextType = useMemo(() => ({
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
    isMounted,
    isLoading,
    error,
    clearError,
  }), [theme, resolvedTheme, setTheme, toggleTheme, isMounted, isLoading, error, clearError]);

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
  return {
    setTheme,
    toggleTheme,
    clearError,
  };
}
