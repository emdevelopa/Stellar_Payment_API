"use client";

import { ReactNode } from "react";
import { ThemeProvider as EnhancedThemeProvider } from "@/lib/theme-context";

interface ThemeProviderWrapperProps {
  readonly children: ReactNode;
}

export default function ThemeProvider({ children }: ThemeProviderWrapperProps) {
  return (
    <EnhancedThemeProvider
      defaultTheme="system"
      enableSystem={true}
      storageKey="merchant-theme-preference"
    >
      {children}
    </EnhancedThemeProvider>
  );
}
