"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "merchant-display-hide-cents";

interface DisplayPreferencesContextValue {
  hideCents: boolean;
  setHideCents: (value: boolean) => void;
}

const DisplayPreferencesContext = createContext<DisplayPreferencesContextValue | null>(null);

function parseHideCents(value: string | null): boolean {
  return value === "true";
}

export function formatAmount(
  value: number | string,
  locale: string | undefined,
  hideCents: boolean,
) {
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(number)) {
    return String(value);
  }

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: hideCents && Number.isInteger(number) ? 0 : 2,
    maximumFractionDigits: 7,
  }).format(number);
}

export function DisplayPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [hideCents, setHideCents] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedValue = window.localStorage.getItem(STORAGE_KEY);
    setHideCents(parseHideCents(storedValue));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, String(hideCents));
  }, [hideCents]);

  const value = useMemo(
    () => ({ hideCents, setHideCents }),
    [hideCents],
  );

  return (
    <DisplayPreferencesContext.Provider value={value}>
      {children}
    </DisplayPreferencesContext.Provider>
  );
}

export function useDisplayPreferences() {
  const context = useContext(DisplayPreferencesContext);
  if (!context) {
    throw new Error(
      "useDisplayPreferences must be used within a DisplayPreferencesProvider",
    );
  }
  return context;
}
