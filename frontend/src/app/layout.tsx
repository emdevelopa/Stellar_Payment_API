import "./globals.css";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import ThemeProvider from "@/components/ThemeProvider";
import ErrorBoundary from "@/components/ErrorBoundary";
import Navbar from "@/components/Navbar";
import ToastProvider from "@/components/ToastProvider";
import CommandPalette from "@/components/CommandPalette";

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const spaceMono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-mono", display: "swap" });

export const metadata = {
  title: "Stellar Payment Dashboard",
  description: "Accept Stellar payments with simple links and status tracking."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${spaceGrotesk.variable} ${spaceMono.variable} min-h-screen font-sans`}>
        <ThemeProvider>
          <ToastProvider />
          <CommandPalette />
          <Navbar />
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  );
}
