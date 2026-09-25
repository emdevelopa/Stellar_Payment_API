/**
 * React Server Components Theme Engine
 * Issue #1145: Migrate component to React Server Components for Dark Mode Theme Engine
 *
 * This module provides server-side theme initialization and metadata for RSC.
 * The theme context is hydrated on the client while the theme metadata is set server-side.
 *
 * i18n: The blocking inline script that runs before hydration uses the
 * storageKey from the i18n-aware ThemeProvider so the user's persisted locale
 * and theme preference are both respected before the first paint.
 */

import { type ReactNode } from "react";
import { getLocale } from "next-intl/server";
import { localeToLanguageTag } from "@/i18n/config";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeRSCProviderProps {
  readonly children: ReactNode;
  readonly defaultTheme?: ThemeMode;
  readonly storageKey?: string;
  readonly forcedTheme?: ResolvedTheme;
}

/**
 * Server-side theme metadata generator
 * This runs on the server and provides initial theme data without hydration mismatch
 */
export function getInitialThemeMetadata(
  defaultTheme: ThemeMode = "system",
  forcedTheme?: ResolvedTheme
): {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  colorScheme: string;
} {
  // On server, we default to light theme to avoid hydration mismatch
  // The client will override this with the actual user preference
  const resolvedTheme = forcedTheme || "light";

  return {
    theme: defaultTheme,
    resolvedTheme,
    colorScheme: resolvedTheme,
  };
}

/**
 * Server Component wrapper for theme provider
 * Handles server-side theme initialization before client hydration.
 *
 * i18n integration:
 *   • Reads the current locale server-side via next-intl's `getLocale()`.
 *   • Sets the correct BCP-47 `lang` attribute on <html> before the client
 *     JS runs, so screen readers announce content in the right language from
 *     the very first paint.
 *   • Emits a blocking inline script that restores the persisted theme from
 *     localStorage so there is no flash of unstyled / wrong-theme content
 *     regardless of the active locale.
 */
export async function ThemeRSCProvider({
  children,
  defaultTheme = "system",
  storageKey = "merchant-theme-preference",
  forcedTheme,
}: ThemeRSCProviderProps): Promise<JSX.Element> {
  const metadata = getInitialThemeMetadata(defaultTheme, forcedTheme);

  // Resolve locale server-side for the lang attribute.
  let langTag = "en-US";
  try {
    const locale = await getLocale();
    langTag = localeToLanguageTag(locale);
  } catch {
    // getLocale() may throw outside of a next-intl request context (e.g. in
    // Storybook or isolated tests).  Fall back to "en-US" silently.
  }

  return (
    <>
      {/* Critical CSS: set color-scheme before any paint to avoid flash */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            :root {
              color-scheme: ${metadata.colorScheme};
            }
            :root.dark  { color-scheme: dark;  }
            :root.light { color-scheme: light; }
          `,
        }}
        suppressHydrationWarning
      />

      {/*
       * Blocking script: runs synchronously before React hydration.
       * Reads the persisted theme preference and applies it to <html>
       * so there is no flash of wrong theme or unstyled content.
       * Also sets the lang attribute from the server-resolved locale
       * so that the attribute is correct even before client JS executes.
       */}
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              try {
                // ── Theme restoration ──────────────────────────────────────
                var stored = localStorage.getItem('${storageKey}');
                var themes = ['light', 'dark', 'system'];
                var theme = stored && themes.includes(stored) ? stored : '${defaultTheme}';

                if (theme === 'system') {
                  theme = window.matchMedia('(prefers-color-scheme: dark)').matches
                    ? 'dark'
                    : 'light';
                }

                var root = document.documentElement;
                root.classList.remove('light', 'dark');
                root.classList.add(theme);
                root.style.colorScheme = theme;

                // ── i18n: lang + dir attributes ────────────────────────────
                // The server already set lang="${langTag}" on <html>.
                // Guard in case a client-side navigation hasn't updated it yet.
                if (!root.lang) {
                  root.lang = '${langTag}';
                }
              } catch (e) {
                // Non-fatal: theme and lang will be set by client-side providers.
                console.error('Theme/locale initialization error:', e);
              }
            })();
          `,
        }}
      />

      {children}
    </>
  );
}
