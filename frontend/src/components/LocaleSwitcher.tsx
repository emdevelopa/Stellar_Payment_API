"use client";

import { useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  localeCookieMaxAge,
  localeCookieName,
  type AppLocale,
  locales,
  resolveAppLocale,
} from "@/i18n/config";
import { usePathname, useRouter } from "@/i18n/navigation";

interface LocaleSwitcherProps {
  className?: string;
}

export default function LocaleSwitcher({
  className = "",
}: LocaleSwitcherProps) {
  const t = useTranslations("localeSwitcher");
  const locale = resolveAppLocale(useLocale());
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleChange = (nextLocale: AppLocale) => {
    if (nextLocale === locale) return;

    document.cookie = `${localeCookieName}=${nextLocale}; path=/; max-age=${localeCookieMaxAge}; samesite=lax`;

    const query = searchParams.toString();
    const href = query ? `${pathname}?${query}` : pathname;

    startTransition(() => {
      router.replace(href, {
        locale: nextLocale,
        scroll: false,
      });
    });
  };

  return (
    <label
      className={`inline-flex items-center gap-2 rounded-xl border border-[#1F1F1F] bg-black px-3 py-2 text-xs text-[#A0A0A0] transition-all hover:border-white/20 ${className}`}
    >
      <span className="font-black uppercase tracking-[0.2em] text-[#A0A0A0]">
        {t("label")}
      </span>
      <select
        aria-label={t("ariaLabel")}
        value={locale}
        onChange={(event) => handleChange(event.target.value as AppLocale)}
        disabled={isPending}
        className="bg-transparent text-sm text-white outline-none"
      >
        {locales.map((option) => (
          <option key={option} value={option} className="bg-black text-white">
            {t(`options.${option}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
