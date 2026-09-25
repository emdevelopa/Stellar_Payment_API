import "./globals.css";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import ThemeProvider from "@/components/ThemeProvider";
import ThemeLanguageSync from "@/components/ThemeLanguageSync";
import ErrorBoundary from "@/components/ErrorBoundary";
import ToastProvider from "@/components/ToastProvider";
import CommandPalette from "@/components/CommandPalette";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";
import { WalletContextProvider } from "@/lib/wallet-context";
import { DisplayPreferencesProvider } from "@/lib/display-preferences";
import { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "PLUTO | Web3 Payments",
  description: "The Hub for Decentralized Commerce on Stellar.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PLUTO",
  },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
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
        <meta name="theme-color" content="#FFFFFF" />
      </head>
      <body className="min-h-screen font-sans bg-white text-[#0A0A0A]">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <ThemeLanguageSync />
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
