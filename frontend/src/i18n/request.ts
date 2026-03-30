import {cookies} from 'next/headers';
import {getRequestConfig} from 'next-intl/server';
import {defaultLocale, localeCookieName, resolveAppLocale} from './config';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = resolveAppLocale(
    cookieStore.get(localeCookieName)?.value ?? defaultLocale
  );

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default
  };
});