"use client";

/**
 * ThemeLanguageSync
 *
 * Keeps the <html> element's `lang` and `dir` attributes in sync with the
 * active next-intl locale whenever it changes on the client.  This is
 * especially important for RTL locales and assistive technologies that rely
 * on the `lang` attribute to choose the right voice / font / hyphenation.
 *
 * It also bridges locale awareness into the Dark Mode Theme Engine by
 * exposing the current locale via a `data-locale` attribute on <html>,
 * which CSS or analytics can reference.
 *
 * Usage: render once, high in the tree (e.g. inside the root layout body,
 * alongside <ThemeProvider>).
 *
 *   <ThemeLanguageSync />
 */

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { localeToLanguageTag } from "@/i18n/config";

/** Locales that are written right-to-left. Extend as needed. */
const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);

function getDir(locale: string): "ltr" | "rtl" {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

export default function ThemeLanguageSync() {
  const locale = useLocale();

  useEffect(() => {
    if (typeof document === "undefined") return;

    const html = document.documentElement;
    const languageTag = localeToLanguageTag(locale);
    const dir = getDir(locale);

    // Update lang / dir only when they actually differ to avoid layout thrash.
    if (html.lang !== languageTag) html.lang = languageTag;
    if (html.dir !== dir) html.dir = dir;

    // Expose locale to CSS / analytics via a data attribute.
    html.dataset.locale = locale;
  }, [locale]);

  // This component renders nothing — it is a pure side-effect.
  return null;
}
