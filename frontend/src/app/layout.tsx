import "./globals.css";
import { Outfit, Instrument_Serif, Space_Mono } from "next/font/google";
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

const displayFont = Instrument_Serif({ subsets: ["latin"], weight: ["400"], variable: "--font-display", display: "swap" });
const sansFont = Outfit({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const monoFont = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-mono", display: "swap" });

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
      <body className={`${displayFont.variable} ${sansFont.variable} ${monoFont.variable} min-h-screen font-sans bg-white text-[#0A0A0A]`}>
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
