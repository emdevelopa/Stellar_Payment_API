"use client";

import { useEffect } from "react";
import { create } from "zustand";

const TOKEN_KEY = "merchant_token";
const API_KEY_KEY = "merchant_api_key";
const MERCHANT_KEY = "merchant_metadata";

export interface MerchantSession {
  id: string;
  email: string;
  exp: number;
}

export interface TrustedAddress {
  id: string;
  label: string;
  address: string;
  created_at: string;
}

export interface MerchantMetadata {
  id: string;
  email: string;
  business_name: string;
  notification_email: string;
  api_key: string;
  webhook_secret: string;
  branding_config?: {
    primary_color?: string;
    secondary_color?: string;
    background_color?: string;
  } | null;
  merchant_settings?: {
    send_success_emails?: boolean;
  } | null;
  trusted_addresses?: TrustedAddress[] | null;
  created_at: string;
}

interface MerchantStore {
  hydrated: boolean;
  token: string | null;
  session: MerchantSession | null;
  apiKey: string | null;
  merchant: MerchantMetadata | null;
  hydrate: () => void;
  setToken: (token: string | null) => void;
  setApiKey: (apiKey: string | null) => void;
  setMerchant: (merchant: MerchantMetadata | null) => void;
  addTrustedAddress: (address: TrustedAddress) => void;
  removeTrustedAddress: (id: string) => void;
  logout: () => void;
}

function parseJwtPayload(token: string): MerchantSession | null {
  try {
    const [, payloadB64] = token.split(".");
    const json = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as MerchantSession;
  } catch {
    return null;
  }
}

function readInitialToken(): {
  token: string | null;
  session: MerchantSession | null;
} {
  if (typeof window === "undefined") {
    return { token: null, session: null };
  }

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return { token: null, session: null };

  const session = parseJwtPayload(token);
  if (!session || Date.now() / 1000 >= session.exp) {
    localStorage.removeItem(TOKEN_KEY);
    return { token: null, session: null };
  }

  return { token, session };
}

function readInitialMerchant(): MerchantMetadata | null {
  if (typeof window === "undefined") return null;

  const raw = localStorage.getItem(MERCHANT_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as MerchantMetadata;
  } catch {
    localStorage.removeItem(MERCHANT_KEY);
    return null;
  }
}

export const useMerchantStore = create<MerchantStore>((set) => ({
  hydrated: false,
  token: null,
  session: null,
  apiKey: null,
  merchant: null,

  hydrate: () => {
    const { token, session } = readInitialToken();
    const apiKey =
      typeof window === "undefined" ? null : localStorage.getItem(API_KEY_KEY);
    const merchant = readInitialMerchant();

    set({
      hydrated: true,
      token,
      session,
      apiKey,
      merchant,
    });
  },

  setToken: (token) => {
    if (typeof window !== "undefined") {
      if (!token) {
        localStorage.removeItem(TOKEN_KEY);
      } else {
        localStorage.setItem(TOKEN_KEY, token);
      }
    }

    const session = token ? parseJwtPayload(token) : null;
    if (session && Date.now() / 1000 < session.exp) {
      set({ token, session });
      return;
    }

    if (typeof window !== "undefined") {
      localStorage.removeItem(TOKEN_KEY);
    }
    set({ token: null, session: null });
  },

  setApiKey: (apiKey) => {
    if (typeof window !== "undefined") {
      if (apiKey) {
        localStorage.setItem(API_KEY_KEY, apiKey);
      } else {
        localStorage.removeItem(API_KEY_KEY);
      }
    }
    set({ apiKey });
  },

  setMerchant: (merchant) => {
    if (typeof window !== "undefined") {
      if (merchant) {
        localStorage.setItem(MERCHANT_KEY, JSON.stringify(merchant));
      } else {
        localStorage.removeItem(MERCHANT_KEY);
      }
    }
    set({ merchant });
  },

  addTrustedAddress: (address) => {
    set((state) => {
      if (!state.merchant) return state;
      
      const currentAddresses = state.merchant.trusted_addresses || [];
      const updatedAddresses = [...currentAddresses, address];
      
      const updatedMerchant = {
        ...state.merchant,
        trusted_addresses: updatedAddresses,
      };
      
      if (typeof window !== "undefined") {
        localStorage.setItem(MERCHANT_KEY, JSON.stringify(updatedMerchant));
      }
      
      return { merchant: updatedMerchant };
    });
  },

  removeTrustedAddress: (id) => {
    set((state) => {
      if (!state.merchant) return state;
      
      const currentAddresses = state.merchant.trusted_addresses || [];
      const updatedAddresses = currentAddresses.filter((addr) => addr.id !== id);
      
      const updatedMerchant = {
        ...state.merchant,
        trusted_addresses: updatedAddresses,
      };
      
      if (typeof window !== "undefined") {
        localStorage.setItem(MERCHANT_KEY, JSON.stringify(updatedMerchant));
      }
      
      return { merchant: updatedMerchant };
    });
  },

  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(TOKEN_KEY);
    }
    set({ token: null, session: null });
  },
}));

export function useHydrateMerchantStore() {
  const hydrate = useMerchantStore((state) => state.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);
}

export function useMerchantHydrated() {
  return useMerchantStore((state) => state.hydrated);
}

export function useMerchantSession() {
  return useMerchantStore((state) => state.session);
}

export function useMerchantApiKey() {
  return useMerchantStore((state) => state.apiKey);
}

export function useMerchantMetadata() {
  return useMerchantStore((state) => state.merchant);
}

export function useSetMerchantToken() {
  return useMerchantStore((state) => state.setToken);
}

export function useSetMerchantApiKey() {
  return useMerchantStore((state) => state.setApiKey);
}

export function useSetMerchantMetadata() {
  return useMerchantStore((state) => state.setMerchant);
}

export function useMerchantLogout() {
  return useMerchantStore((state) => state.logout);
}

export function useMerchantTrustedAddresses() {
  return useMerchantStore((state) => state.merchant?.trusted_addresses || []);
}

export function useAddTrustedAddress() {
  return useMerchantStore((state) => state.addTrustedAddress);
}

export function useRemoveTrustedAddress() {
  return useMerchantStore((state) => state.removeTrustedAddress);
}

export function useMerchantId() {
  return useMerchantStore((state) => state.merchant?.id ?? null);
}
