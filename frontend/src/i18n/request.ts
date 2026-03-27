import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  defaultLocale,
  localeCookieName,
  resolveAppLocale,
} from "@/i18n/config";

export default getRequestConfig(async () => {
  const locale = resolveAppLocale(
    cookies().get(localeCookieName)?.value ?? defaultLocale,
  );

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
