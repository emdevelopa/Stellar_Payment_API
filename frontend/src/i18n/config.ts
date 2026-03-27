export const locales = ["en", "es", "pt"] as const;

export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = "en";
export const localeCookieName = "NEXT_LOCALE";

export function isValidLocale(value: string | null | undefined): value is AppLocale {
  return locales.includes((value ?? "") as AppLocale);
}

export function resolveAppLocale(value: string | null | undefined): AppLocale {
  return isValidLocale(value) ? value : defaultLocale;
}

export function localeToLanguageTag(locale: string): string {
  const normalized = resolveAppLocale(locale);

  switch (normalized) {
    case "es":
      return "es-ES";
    case "pt":
      return "pt-BR";
    case "en":
    default:
      return "en-US";
  }
}
