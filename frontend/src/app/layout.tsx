import "./globals.css";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import ThemeProvider from "@/components/ThemeProvider";
import ErrorBoundary from "@/components/ErrorBoundary";
import ToastProvider from "@/components/ToastProvider";
import CommandPalette from "@/components/CommandPalette";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";
import { WalletContextProvider } from "@/lib/wallet-context";
import { DisplayPreferencesProvider } from "@/lib/display-preferences";
import { Metadata, Viewport } from "next";

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const spaceMono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Stellar Payment Dashboard",
  description: "Accept Stellar payments with simple links and status tracking.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "StellarPay",
  },
};

export const viewport: Viewport = {
  themeColor: "#5ef2c0",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('merchant-theme-preference');
                  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
                  var themeToApply = 'light';
                  if (theme === 'dark' || ((!theme || theme === 'system') && darkQuery.matches)) {
                    themeToApply = 'dark';
                  }
                  document.documentElement.classList.remove('light', 'dark');
                  document.documentElement.classList.add(themeToApply);
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className={`${spaceGrotesk.variable} ${spaceMono.variable} min-h-screen font-sans`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <DisplayPreferencesProvider>
              <WalletContextProvider>
                <ToastProvider />
                <CommandPalette />
                <KeyboardShortcuts />
                <ErrorBoundary>
                  {children}
                </ErrorBoundary>
              </WalletContextProvider>
            </DisplayPreferencesProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
