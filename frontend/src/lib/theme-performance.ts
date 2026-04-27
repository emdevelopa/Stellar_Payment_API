import { useCallback, useRef, useEffect } from "react";

export function useThemePerformance() {
  const renderCountRef = useRef(0);
  const lastThemeChangeRef = useRef<number>(Date.now());

  useEffect(() => {
    renderCountRef.current += 1;
  });

  const trackThemeChange = useCallback(() => {
    lastThemeChangeRef.current = Date.now();
  }, []);

  const getPerformanceMetrics = useCallback(() => {
    return {
      renderCount: renderCountRef.current,
      lastThemeChange: lastThemeChangeRef.current,
      timeSinceLastChange: Date.now() - lastThemeChangeRef.current,
    };
  }, []);

  return {
    trackThemeChange,
    getPerformanceMetrics,
  };
}

export function useThemeDebounce(callback: () => void, delay: number) {
  const timeoutRef = useRef<NodeJS.Timeout>();

  const debouncedCallback = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(callback, delay);
  }, [callback, delay]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

export function validateThemeStorage(theme: string): boolean {
  if (typeof theme !== "string") return false;
  const validThemes = ["light", "dark", "system"];
  return validThemes.includes(theme);
}

export function sanitizeThemeInput(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const sanitized = input.trim().toLowerCase();
  return validateThemeStorage(sanitized) ? sanitized : null;
}
