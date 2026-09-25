"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import { useOptimisticUpdate } from "@/hooks/useOptimisticUpdate";
import Link from "next/link";
import Image from "next/image";
import CopyButton from "@/components/CopyButton";
import { toast } from "sonner";
import {
  useHydrateMerchantStore,
  useMerchantApiKey,
  useMerchantHydrated,
  useSetMerchantApiKey,
} from "@/lib/merchant-store";
import { useDisplayPreferences } from "@/lib/display-preferences";
import SettingsPanelSkeleton from "@/components/SettingsPanelSkeleton";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { Spinner } from "@/components/ui/Spinner";
import {
  getNextSettingsTab,
  getSettingsPanelDomId,
  getSettingsTabDomId,
  type SettingsTab,
} from "./accessibility";

const UserPermissionsManager = dynamic(
  () => import("@/components/UserPermissionsManager"),
  {
    ssr: false,
    loading: () => <SettingsPanelSkeleton />,
  },
);
const WebhookHealthIndicator = dynamic(
  () => import("@/components/WebhookHealthIndicator"),
  { ssr: false },
);
const DangerZone = dynamic(() => import("@/components/DangerZone"), {
  ssr: false,
  loading: () => <SettingsPanelSkeleton />,
});
const EmailReceiptPreview = dynamic(
  () =>
    import("@/components/EmailReceiptPreview").then(
      (mod) => mod.EmailReceiptPreview,
    ),
  { ssr: false },
);

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
const DEFAULT_BRANDING = {
  primary_color: "#5ef2c0",
  secondary_color: "#b8ffe2",
  background_color: "#050608",
  logo_url: null as string | null,
};
const BRANDING_FIELD_LABEL_KEYS: Record<string, string> = {
  primary_color: "primary",
  secondary_color: "secondary",
  background_color: "background",
};
const LOGO_ACCEPT = ".png,.jpg,.jpeg,.svg";
const LOGO_FILE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "svg"]);


interface WebhookDomainVerification {
  status: "verified" | "unverified";
  domain: string | null;
  verification_token: string | null;
  verification_file_url: string | null;
  checked_at: string | null;
  verified_at: string | null;
  failure_reason: string | null;
}

function normalizeHexInput(v: string) {
  const t = v.trim();
  return t.startsWith("#") ? t : `#${t}`;
}

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => `${c}${c}`)
          .join("")
      : clean;
  const int = Number.parseInt(full, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function luminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const t = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * t(r) + 0.7152 * t(g) + 0.0722 * t(b);
}

function contrastRatio(fg: string, bg: string) {
  const l1 = luminance(fg),
    l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function mask(key: string) {
  if (key.length <= 12) return "•".repeat(key.length);
  return key.slice(0, 7) + "•".repeat(key.length - 13) + key.slice(-6);
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M17.94 17.94A10.1 10.1 0 0 1 12 19c-6.4 0-10-7-10-7a18.1 18.1 0 0 1 5.06-5.94M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a18.1 18.1 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" />
    </svg>
  );
}

function buildNavItems(t: (key: string) => string): {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
}[] {
  return [
  {
    id: "api",
    label: t("navApiKeys"),
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
        />
      </svg>
    ),
  },
  {
    id: "branding",
    label: t("navBranding"),
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
        />
      </svg>
    ),
  },
  {
    id: "display",
    label: t("navDisplay"),
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    id: "webhooks",
    label: t("navWebhooks"),
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    id: "permissions",
    label: t("navPermissions"),
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
  {
    id: "danger",
    label: t("navDanger"),
    icon: (
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    ),
    danger: true,
  },
  ];
}

export default function SettingsWidget() {
  const t = useTranslations("settingsPage");
  const navItems = useMemo(() => buildNavItems(t), [t]);
  const apiKey = useMerchantApiKey();
  const hydrated = useMerchantHydrated();
  const setApiKey = useSetMerchantApiKey();
  const [revealed, setRevealed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("api");
  const { hideCents, setHideCents } = useDisplayPreferences();
  const {
    state: branding,
    setState: setBranding,
    isPending: savingBranding,
    executeUpdate: executeBrandingUpdate,
  } = useOptimisticUpdate(DEFAULT_BRANDING);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [loadingBranding, setLoadingBranding] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const {
    state: webhookUrl,
    setState: setWebhookUrl,
    isPending: savingWebhook,
    executeUpdate: executeWebhookUpdate,
  } = useOptimisticUpdate("");
  const [webhookSecretMasked, setWebhookSecretMasked] = useState("");
  const [webhookNewSecret, setWebhookNewSecret] = useState<string | null>(null);
  const [webhookUrlError, setWebhookUrlError] = useState<string | null>(null);
  const [webhookSaveError, setWebhookSaveError] = useState<string | null>(null);
  const [loadingWebhook, setLoadingWebhook] = useState(false);
  const [regeneratingSecret, setRegeneratingSecret] = useState(false);
  const [confirmRegenSecret, setConfirmRegenSecret] = useState(false);
  const [webhookRevealedSecret, setWebhookRevealedSecret] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookVerification, setWebhookVerification] =
    useState<WebhookDomainVerification | null>(null);
  const [verifyingWebhookDomain, setVerifyingWebhookDomain] = useState(false);
  const desktopTabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});
  const mobileTabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [isLogoDragActive, setIsLogoDragActive] = useState(false);

  useHydrateMerchantStore();

  useEffect(() => {
    if (!apiKey) return;
    const load = async () => {
      setLoadingBranding(true);
      try {
        const res = await fetch(`${API_URL}/api/merchant-branding`, {
          headers: { "x-api-key": apiKey },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("failedToLoadBranding"));
        setBranding(data.branding_config ?? DEFAULT_BRANDING);
      } catch (err: unknown) {
        setBrandingError(
          err instanceof Error ? err.message : t("failedToLoadBranding"),
        );
      } finally {
        setLoadingBranding(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is not stable across renders and must not retrigger this fetch
  }, [apiKey]);

  useEffect(() => {
    if (!apiKey) return;
    const load = async () => {
      setLoadingWebhook(true);
      try {
        const res = await fetch(`${API_URL}/api/webhook-settings`, {
          headers: { "x-api-key": apiKey },
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(data.error ?? t("failedToLoadWebhookSettings"));
        setWebhookUrl(data.webhook_url ?? "");
        setWebhookSecretMasked(data.webhook_secret_masked ?? "");
        setWebhookVerification(data.webhook_domain_verification ?? null);
      } catch (err: unknown) {
        setWebhookSaveError(
          err instanceof Error
            ? err.message
            : t("failedToLoadWebhookSettings"),
        );
      } finally {
        setLoadingWebhook(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is not stable across renders and must not retrigger this fetch
  }, [apiKey]);

  const confirmRotate = useCallback(async () => {
    if (!apiKey) return;
    setRotating(true);
    setRotateError(null);
    try {
      const res = await fetch(`${API_URL}/api/rotate-key`, {
        method: "POST",
        headers: { "x-api-key": apiKey },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("failedToRotateKey"));
      setApiKey(data.api_key);
      setRevealed(true);
      setConfirming(false);
      toast.success(t("apiKeyRotatedSuccess"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("failedToRotateKey");
      setRotateError(msg);
      toast.error(msg);
    } finally {
      setRotating(false);
    }
  }, [apiKey, setApiKey, t]);

  const updateBrandingField = useCallback(
    (key: keyof typeof DEFAULT_BRANDING, value: string | null) => {
      setBranding((c) => ({
        ...c,
        [key]: key === "logo_url" ? value : normalizeHexInput(value as string),
      }));
    },
    [],
  );

  const handleLogoFiles = useCallback(
    (files: FileList | File[] | null) => {
      const file = files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        toast.error(t("imageSizeLimit"));
        return;
      }
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!extension || !LOGO_FILE_EXTENSIONS.has(extension)) {
        toast.error(t("logoFormats"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        updateBrandingField("logo_url", reader.result as string);
        toast.success(t("logoUploaded"));
      };
      reader.readAsDataURL(file);
    },
    [updateBrandingField, t],
  );

  const handleLogoDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsLogoDragActive(false);
      handleLogoFiles(event.dataTransfer.files);
    },
    [handleLogoFiles],
  );

  const saveBranding = useCallback(async () => {
    if (!apiKey) return;
    setBrandingError(null);
    for (const [k, v] of Object.entries(branding)) {
      if (k === "logo_url") continue;
      if (!HEX_COLOR_REGEX.test(v as string)) {
        setBrandingError(
          t("hexColorRequired", { field: t(BRANDING_FIELD_LABEL_KEYS[k] ?? k) }),
        );
        return;
      }
    }
    await executeBrandingUpdate(
      (current) => current, // optimistically keep current branding
      async () => {
        const res = await fetch(`${API_URL}/api/merchant-branding`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey },
          body: JSON.stringify(branding),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("failedToSaveBranding"));
        setBranding(data.branding_config ?? branding);
        toast.success(t("brandingSaved"));
      }
    );
  }, [apiKey, branding, executeBrandingUpdate, setBranding, t]);

  const validateWebhookUrl = useCallback((url: string) => {
    if (!url.trim()) return null;
    try {
      const p = new URL(url);
      if (p.protocol !== "https:") return t("webhookUrlMustBeHttps");
      return null;
    } catch {
      return t("webhookUrlInvalid");
    }
  }, [t]);

  const handleWebhookUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setWebhookUrl(() => e.target.value);
      setWebhookUrlError(validateWebhookUrl(e.target.value));
    },
    [validateWebhookUrl, setWebhookUrl],
  );

  const saveWebhookUrl = useCallback(async () => {
    if (!apiKey) return;
    const err = validateWebhookUrl(webhookUrl);
    if (err) {
      setWebhookUrlError(err);
      return;
    }
    setWebhookSaveError(null);
    const optimisticUrl = webhookUrl.trim();
    await executeWebhookUpdate(
      () => optimisticUrl, // optimistically show the trimmed URL immediately
      async () => {
        const res = await fetch(`${API_URL}/api/webhook-settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey },
          body: JSON.stringify({ webhook_url: optimisticUrl || undefined }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("failedToSaveWebhookUrl"));
        setWebhookUrl(data.webhook_url ?? "");
        setWebhookVerification(data.webhook_domain_verification ?? null);
        toast.success(
          data.webhook_url ? t("webhookUrlSaved") : t("webhookUrlCleared"),
        );
      }
    );
  }, [apiKey, webhookUrl, validateWebhookUrl, executeWebhookUpdate, setWebhookUrl, t]);

  const verifyWebhookDomain = useCallback(async () => {
    if (!apiKey) return;
    setVerifyingWebhookDomain(true);
    setWebhookSaveError(null);
    try {
      const res = await fetch(`${API_URL}/api/webhook-settings/verify`, {
        method: "POST",
        headers: { "x-api-key": apiKey },
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error ?? t("failedToVerifyDomain"));
      setWebhookVerification(data.webhook_domain_verification ?? null);
      toast.success(
        data.webhook_domain_verification?.status === "verified"
          ? t("domainVerified")
          : t("domainStillUnverified"),
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : t("failedToVerifyDomain");
      setWebhookSaveError(msg);
      toast.error(msg);
    } finally {
      setVerifyingWebhookDomain(false);
    }
  }, [apiKey, t]);

  const regenerateWebhookSecret = useCallback(async () => {
    if (!apiKey) return;
    setRegeneratingSecret(true);
    setWebhookSaveError(null);
    try {
      const res = await fetch(`${API_URL}/api/regenerate-webhook-secret`, {
        method: "POST",
        headers: { "x-api-key": apiKey },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("failedToRegenerateSecret"));
      setWebhookNewSecret(data.webhook_secret);
      setWebhookRevealedSecret(true);
      setConfirmRegenSecret(false);
      toast.success(t("webhookSecretRegenerated"));
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : t("failedToRegenerateSecret");
      setWebhookSaveError(msg);
      toast.error(msg);
    } finally {
      setRegeneratingSecret(false);
    }
  }, [apiKey, t]);

  const testWebhook = useCallback(async () => {
    if (!apiKey) return;
    setTestingWebhook(true);
    setWebhookSaveError(null);
    try {
      const res = await fetch(`${API_URL}/api/webhooks/test`, {
        method: "POST",
        headers: { "x-api-key": apiKey },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("testWebhookRequestFailed"));
      toast.success(t("testWebhookSentStatus", { status: data.status }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("failedToTestWebhook");
      toast.error(msg);
      setWebhookSaveError(msg);
    } finally {
      setTestingWebhook(false);
    }
  }, [apiKey, t]);

  const displayKey = useMemo(
    () => (revealed ? apiKey : mask(apiKey ?? "")),
    [revealed, apiKey],
  );
  const lowContrastWarning = useMemo(
    () =>
      contrastRatio(branding.primary_color, branding.background_color) < 4.5 ||
      contrastRatio(branding.secondary_color, branding.background_color) < 3,
    [branding.primary_color, branding.secondary_color, branding.background_color],
  );
  const isVerified = useMemo(
    () => webhookVerification?.status === "verified",
    [webhookVerification],
  );

  const focusTab = useCallback((tab: SettingsTab, variant: "desktop" | "mobile") => {
    const refMap = variant === "desktop" ? desktopTabRefs.current : mobileTabRefs.current;
    refMap[tab]?.focus();
  }, []);

  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, variant: "desktop" | "mobile") => {
      const supportedKeys = [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ];

      if (!supportedKeys.includes(event.key)) {
        return;
      }

      event.preventDefault();
      const nextTab = getNextSettingsTab(activeTab, event.key);
      setActiveTab(nextTab);
      focusTab(nextTab, variant);
    },
    [activeTab, focusTab],
  );

  if (!hydrated) {
    return (
      <div
        className="flex flex-col gap-8 animate-in fade-in duration-500"
        aria-busy="true"
      >
        <p role="status" aria-live="polite" className="sr-only">
          {t("loadingSettings")}
        </p>
        <SkeletonTheme baseColor="#F0F0F0" highlightColor="#F9F9F9">
          <div>
            <Skeleton width={140} height={12} borderRadius={4} />
            <div className="mt-2">
              <Skeleton width={220} height={32} borderRadius={6} />
            </div>
          </div>
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start mt-8">
            <div className="hidden lg:flex w-52 shrink-0 flex-col gap-1">
              {Array.from({ length: navItems.length }).map((_, i) => (
                <Skeleton key={i} height={44} borderRadius={12} />
              ))}
            </div>
            <div className="flex-1 min-w-0">
              <SettingsPanelSkeleton />
            </div>
          </div>
        </SkeletonTheme>
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div className="flex flex-col gap-8 animate-in fade-in duration-500">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B] mb-2">
            {t("eyebrow")}
          </p>
          <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">
            {t("title")}
          </h1>
        </div>
        <div className="max-w-md rounded-2xl border border-yellow-200 bg-yellow-50 p-8 flex flex-col gap-4">
          <p className="font-bold text-yellow-800">{t("noApiKeyTitle")}</p>
          <p className="text-sm text-yellow-700">
            {t("noApiKeyDescription")}
          </p>
          <Link
            href="/register"
            className="self-start rounded-xl bg-[#0A0A0A] px-5 py-2.5 text-sm font-bold text-white hover:bg-black transition-all"
          >
            {t("registerAsMerchant")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      {/* Page header */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#6B6B6B] mb-2">
          {t("eyebrowAccount")}
        </p>
        <h1 className="text-4xl font-bold text-[#0A0A0A] tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-2 text-sm font-medium text-[#6B6B6B]">
          {t("description")}
        </p>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        {/* Left nav */}
        <nav
          className="hidden lg:flex w-52 shrink-0 flex-col gap-1"
          role="tablist"
          aria-label={t("navAriaLabel")}
          aria-orientation="vertical"
        >
          {navItems.map((item) => (
            <button
              key={item.id}
              id={getSettingsTabDomId(item.id, "desktop")}
              type="button"
              role="tab"
              aria-selected={activeTab === item.id}
              aria-controls={getSettingsPanelDomId(item.id)}
              tabIndex={activeTab === item.id ? 0 : -1}
              ref={(node) => {
                desktopTabRefs.current[item.id] = node;
              }}
              onClick={() => setActiveTab(item.id)}
              onKeyDown={(event) => handleTabKeyDown(event, "desktop")}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-left transition-all duration-200 ${
                activeTab === item.id
                  ? item.danger
                    ? "bg-red-50 text-red-600 border border-red-200 shadow-sm"
                    : "bg-[var(--pluto-500)] text-white shadow-md scale-[1.02]"
                  : item.danger
                    ? "text-red-500 hover:bg-red-50 hover:shadow-sm hover:scale-[1.01]"
                    : "text-[#6B6B6B] hover:bg-[var(--pluto-50)] hover:text-[var(--pluto-700)] hover:shadow-sm hover:scale-[1.01]"
              }`}
            >
              <span className="shrink-0" aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* Mobile tab bar */}
        <div
          className="lg:hidden flex gap-1 overflow-x-auto rounded-xl border border-[#E8E8E8] bg-[#F5F5F5] p-1 w-full"
          role="tablist"
          aria-label={t("navAriaLabel")}
          aria-orientation="horizontal"
        >
          {navItems.map((item) => (
            <button
              key={item.id}
              id={getSettingsTabDomId(item.id, "mobile")}
              type="button"
              role="tab"
              aria-selected={activeTab === item.id}
              aria-controls={getSettingsPanelDomId(item.id)}
              tabIndex={activeTab === item.id ? 0 : -1}
              ref={(node) => {
                mobileTabRefs.current[item.id] = node;
              }}
              onClick={() => setActiveTab(item.id)}
              onKeyDown={(event) => handleTabKeyDown(event, "mobile")}
              className={`shrink-0 rounded-lg px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-all duration-200 ${
                activeTab === item.id
                  ? item.danger
                    ? "bg-red-500 text-white shadow-md"
                    : "bg-white text-[#0A0A0A] shadow-sm"
                  : item.danger
                    ? "text-red-500 hover:bg-red-50 hover:shadow-sm"
                    : "text-[#6B6B6B] hover:bg-[var(--pluto-50)] hover:shadow-sm"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Right content panel */}
        <div className="flex-1 min-w-0">
          {/* API Keys Tab */}
          {activeTab === "api" && (
            <div
              id={getSettingsPanelDomId("api")}
              role="tabpanel"
              aria-label={t("navApiKeys")}
              aria-labelledby="api-tab api-tab-mobile"
              tabIndex={0}
              className="rounded-2xl border border-[#E8E8E8] bg-white p-8 flex flex-col gap-8"
            >
              <div>
                <h2 className="text-lg font-bold text-[#0A0A0A] mb-1">
                  {t("apiAuthTitle")}
                </h2>
                <p className="text-sm text-[#6B6B6B]">
                  {t("apiAuthDescription")}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="live-api-key"
                    className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]"
                  >
                    {t("liveApiKey")}
                  </label>
                  <button
                    type="button"
                    onClick={() => setRevealed((v) => !v)}
                    aria-pressed={revealed}
                    aria-controls="live-api-key"
                    aria-describedby="live-api-key-visibility"
                    className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors"
                  >
                    <EyeIcon open={revealed} /> {revealed ? t("hide") : t("reveal")}
                  </button>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-1 pl-4">
                  <code
                    id="live-api-key"
                    className={`flex-1 truncate text-sm font-bold tracking-widest ${revealed ? "text-[#0A0A0A]" : "text-[#E8E8E8]"}`}
                  >
                    {displayKey}
                  </code>
                  {revealed && <CopyButton text={apiKey} />}
                </div>
                <p className="text-xs text-[#6B6B6B]">
                  {t("apiKeyHeaderHintPrefix")}{" "}
                  <code className="text-[#0A0A0A]">x-api-key</code>{" "}
                  {t("apiKeyHeaderHintSuffix")}
                </p>
                <p
                  id="live-api-key-visibility"
                  className="sr-only"
                  aria-live="polite"
                >
                  {revealed ? t("apiKeyVisible") : t("apiKeyHidden")}
                </p>
              </div>

              <div className="h-px bg-[#E8E8E8]" />

              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-[#0A0A0A] mb-1">
                    {t("rotateApiKeyTitle")}
                  </h3>
                  <p className="text-xs text-[#6B6B6B]">
                    {t("rotateApiKeyDescription")}
                  </p>
                </div>
                {rotateError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
                    {rotateError}
                  </div>
                )}
                {!confirming ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRotateError(null);
                      setConfirming(true);
                    }}
                    className="self-start rounded-xl border border-red-200 bg-red-50 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-red-600 hover:bg-red-100 transition-all"
                  >
                    {t("rotateKeyEllipsis")}
                  </button>
                ) : (
                  <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5 flex flex-col gap-3">
                    <p className="text-xs font-bold text-yellow-800 uppercase tracking-widest">
                      {t("confirmAction")}
                    </p>
                    <p className="text-xs text-yellow-700">
                      {t("rotateKeyWarning")}
                    </p>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={confirmRotate}
                        disabled={rotating}
                        className="flex-1 min-w-0 flex items-center justify-center gap-2 rounded-xl bg-[var(--pluto-500)] py-2.5 text-xs font-bold uppercase tracking-widest text-white hover:bg-[var(--pluto-600)] hover:shadow-md hover:scale-[1.01] disabled:opacity-50 transition-all duration-200"
                      >
                        {rotating && <Spinner size="sm" className="h-3.5 w-3.5" />}
                        {rotating ? t("rotating") : t("confirm")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(false)}
                        disabled={rotating}
                        className="flex-1 min-w-0 rounded-xl border border-[#E8E8E8] bg-white py-2.5 text-xs font-bold uppercase tracking-widest text-[#6B6B6B] hover:bg-[#F5F5F5] hover:shadow-sm hover:border-[#D0D0D0] disabled:opacity-50 transition-all duration-200"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Branding Tab */}
          {activeTab === "branding" && loadingBranding && (
            <div
              id={getSettingsPanelDomId("branding")}
              role="tabpanel"
              aria-label={t("navBranding")}
              aria-labelledby="branding-tab branding-tab-mobile"
              aria-busy="true"
              tabIndex={0}
            >
              <SettingsPanelSkeleton />
            </div>
          )}
          {activeTab === "branding" && !loadingBranding && (
            <div
              id={getSettingsPanelDomId("branding")}
              role="tabpanel"
              aria-label={t("navBranding")}
              aria-labelledby="branding-tab branding-tab-mobile"
              tabIndex={0}
              className="rounded-2xl border border-[#E8E8E8] bg-white p-8 flex flex-col gap-8"
            >
              <div>
                <h2 className="text-lg font-bold text-[#0A0A0A] mb-1">
                  {t("checkoutBrandingTitle")}
                </h2>
                <p className="text-sm text-[#6B6B6B]">
                  {t("checkoutBrandingDescription")}
                </p>
              </div>

              {/* Logo upload */}
              <div className="flex flex-col gap-3">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                  {t("storeLogo")}
                </label>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => logoInputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      logoInputRef.current?.click();
                    }
                  }}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsLogoDragActive(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    setIsLogoDragActive(false);
                  }}
                  onDrop={handleLogoDrop}
                  className={`relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all ${isLogoDragActive ? "border-[#0A0A0A] bg-[#F9F9F9]" : "border-[#E8E8E8] bg-[#F9F9F9] hover:border-[#0A0A0A]"}`}
                  aria-label={t("uploadLogo")}
                >
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept={LOGO_ACCEPT}
                    className="sr-only"
                    onChange={(event) => {
                      handleLogoFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                  {branding.logo_url ? (
                    <div className="flex flex-col items-center gap-2 p-4">
                      <Image
                        src={branding.logo_url}
                        alt="Logo"
                        width={64}
                        height={64}
                        className="object-contain"
                        unoptimized
                      />
                      <span className="text-xs text-[#6B6B6B]">
                        {t("clickOrDragToReplace")}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 p-6 text-center">
                      <div className="rounded-full bg-white border border-[#E8E8E8] p-3 text-[#6B6B6B]">
                        <svg
                          className="h-5 w-5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-[#0A0A0A]">
                        {isLogoDragActive ? t("dropHere") : t("uploadLogo")}
                      </p>
                      <p className="text-xs text-[#6B6B6B]">
                        {t("logoFormats")}
                      </p>
                    </div>
                  )}
                </div>
                {branding.logo_url && (
                  <button
                    type="button"
                    onClick={() => updateBrandingField("logo_url", null)}
                    className="self-start text-xs text-red-500 hover:text-red-600 transition-colors"
                  >
                    {t("removeLogo")}
                  </button>
                )}
              </div>

              {/* Color pickers */}
              <div className="flex flex-col gap-4">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                  {t("colors")}
                </label>
                {(
                  [
                    ["primary_color", t("primary")],
                    ["secondary_color", t("secondary")],
                    ["background_color", t("background")],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input
                      type="color"
                      value={branding[field]}
                      onChange={(e) =>
                        updateBrandingField(field, e.target.value)
                      }
                      aria-label={t("colorPickerLabel", { label })}
                      className="h-10 w-12 shrink-0 rounded-lg border border-[#E8E8E8] bg-white p-1 cursor-pointer"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <label
                        htmlFor={`color-text-${field}`}
                        className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]"
                      >
                        {label}
                      </label>
                      <input
                        id={`color-text-${field}`}
                        type="text"
                        value={branding[field]}
                        onChange={(e) =>
                          updateBrandingField(field, e.target.value)
                        }
                        className="w-full rounded-lg border border-[#E8E8E8] bg-[#F9F9F9] px-3 py-2 font-mono text-sm text-[#0A0A0A] focus:border-[#0A0A0A] focus:outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Preview */}
              <div className="rounded-xl border border-[#E8E8E8] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#E8E8E8] bg-[#F9F9F9]">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                    {t("preview")}
                  </p>
                </div>
                <div
                  className="p-6"
                  style={{ background: branding.background_color }}
                >
                  <div
                    className="rounded-xl border p-4"
                    style={{ borderColor: `${branding.secondary_color}44` }}
                  >
                    <p
                      className="text-sm font-medium mb-3"
                      style={{ color: branding.secondary_color }}
                    >
                      {t("sampleCheckout")}
                    </p>
                    <button
                      type="button"
                      className="rounded-lg px-4 py-2 text-sm font-bold"
                      style={{
                        background: branding.primary_color,
                        color:
                          contrastRatio(branding.primary_color, "#000") > 5
                            ? "#000"
                            : "#fff",
                      }}
                    >
                      {t("payNow")}
                    </button>
                  </div>
                </div>
              </div>

              {brandingError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
                  {brandingError}
                </div>
              )}
              {lowContrastWarning && (
                <div
                  role="alert"
                  className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-700"
                >
                  {t("lowContrastWarning")}
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={saveBranding}
                  disabled={savingBranding}
                  className="flex-1 min-w-0 flex items-center justify-center gap-2 rounded-xl bg-[var(--pluto-500)] py-3 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-[var(--pluto-600)] hover:shadow-md hover:scale-[1.01] disabled:opacity-50 transition-all duration-200"
                >
                  {savingBranding && <Spinner size="sm" className="h-3.5 w-3.5" />}
                  {savingBranding ? t("saving") : t("saveBranding")}
                </button>
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(true)}
                  disabled={!apiKey}
                  className="flex-1 min-w-0 rounded-xl border border-[#E8E8E8] bg-white px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] hover:bg-[#F5F5F5] hover:text-[#0A0A0A] hover:shadow-sm hover:border-[#D0D0D0] disabled:opacity-50 transition-all duration-200"
                >
                  {t("previewReceipt")}
                </button>
              </div>
            </div>
          )}

          {/* Display Tab */}
          {activeTab === "display" && (
            <div
              id={getSettingsPanelDomId("display")}
              role="tabpanel"
              aria-label={t("navDisplay")}
              aria-labelledby="display-tab display-tab-mobile"
              tabIndex={0}
              className="rounded-2xl border border-[#E8E8E8] bg-white p-8 flex flex-col gap-8 max-w-full"
            >
              <div>
                <h2 className="text-lg font-bold text-[#0A0A0A] mb-1">
                  {t("displayPreferencesTitle")}
                </h2>
                <p className="text-sm text-[#6B6B6B]">
                  {t("displayPreferencesDescription")}
                </p>
              </div>
              <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-5">
                <label className="flex items-start gap-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hideCents}
                    onChange={(e) => setHideCents(e.target.checked)}
                    className="mt-0.5 h-5 w-5 rounded border-[#E8E8E8] text-[#0A0A0A] focus:ring-[#0A0A0A]"
                  />
                  <div>
                    <p className="text-sm font-bold text-[#0A0A0A]">
                      {t("hideTrailingCents")}
                    </p>
                    <p className="text-xs text-[#6B6B6B] mt-1">
                      {t("hideTrailingCentsDescription")}
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Webhooks Tab */}
          {activeTab === "webhooks" && loadingWebhook && (
            <div
              id={getSettingsPanelDomId("webhooks")}
              role="tabpanel"
              aria-label={t("navWebhooks")}
              aria-labelledby="webhooks-tab webhooks-tab-mobile"
              aria-busy="true"
              tabIndex={0}
            >
              <SettingsPanelSkeleton />
            </div>
          )}
          {activeTab === "webhooks" && !loadingWebhook && (
            <div
              id={getSettingsPanelDomId("webhooks")}
              role="tabpanel"
              aria-label={t("navWebhooks")}
              aria-labelledby="webhooks-tab webhooks-tab-mobile"
              tabIndex={0}
              className="rounded-2xl border border-[#E8E8E8] bg-white p-8 flex flex-col gap-8 max-w-full"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-[#0A0A0A] mb-1">
                    {t("webhookEndpointTitle")}
                  </h2>
                  <p className="text-sm text-[#6B6B6B]">
                    {t("webhookEndpointDescription")}
                  </p>
                </div>
                {webhookUrl && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <WebhookHealthIndicator webhookUrl={webhookUrl} />
                    <span
                      role="status"
                      aria-live="polite"
                      className={`rounded-full border px-3 py-1 text-[9px] font-bold uppercase tracking-widest ${isVerified ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-yellow-200 bg-yellow-50 text-yellow-700"}`}
                    >
                      {isVerified ? t("verified") : t("unverified")}
                    </span>
                  </div>
                )}
              </div>

              {webhookSaveError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
                  {webhookSaveError}
                </div>
              )}

              <div className="flex flex-col gap-3">
                <label
                  htmlFor="webhook-url"
                  className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]"
                >
                  {t("endpointUrl")}
                </label>
                <input
                  id="webhook-url"
                  type="url"
                  value={webhookUrl}
                  onChange={handleWebhookUrlChange}
                  placeholder="https://example.com/hooks/pluto"
                  aria-invalid={webhookUrlError ? "true" : "false"}
                  aria-describedby={webhookUrlError ? "webhook-url-error" : undefined}
                  className={`rounded-xl border bg-[#F9F9F9] px-4 py-3 font-mono text-sm text-[#0A0A0A] focus:outline-none focus:bg-white transition-all ${webhookUrlError ? "border-red-300 focus:border-red-500" : "border-[#E8E8E8] focus:border-[#0A0A0A]"}`}
                />
                {webhookUrlError && (
                  <p id="webhook-url-error" className="text-xs text-red-500" role="alert">
                    {webhookUrlError}
                  </p>
                )}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={saveWebhookUrl}
                    disabled={
                      savingWebhook || !!webhookUrlError
                    }
                    className="flex-1 min-w-0 flex items-center justify-center gap-2 rounded-xl bg-[var(--pluto-500)] py-2.5 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-[var(--pluto-600)] hover:shadow-md hover:scale-[1.01] disabled:opacity-50 transition-all duration-200"
                  >
                    {savingWebhook && <Spinner size="sm" className="h-3.5 w-3.5" />}
                    {savingWebhook ? t("saving") : t("saveUrl")}
                  </button>
                  <button
                    type="button"
                    onClick={testWebhook}
                    disabled={testingWebhook || !webhookUrl}
                    className="flex-1 min-w-0 flex items-center justify-center gap-2 rounded-xl border border-[#E8E8E8] bg-white py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] hover:bg-[#F5F5F5] hover:text-[#0A0A0A] hover:shadow-sm hover:border-[#D0D0D0] disabled:opacity-50 transition-all duration-200"
                  >
                    {testingWebhook && <Spinner size="sm" className="h-3.5 w-3.5" />}
                    {testingWebhook ? t("testing") : t("sendTest")}
                  </button>
                </div>
              </div>

              {webhookUrl && webhookVerification && (
                <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-5 flex flex-col gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">
                    {t("domainVerification")}
                  </p>
                  <p className="text-xs text-[#6B6B6B]">
                    {t("hostTokenAt")}{" "}
                    <code className="text-[#0A0A0A] break-all">
                      {webhookVerification.verification_file_url}
                    </code>
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center rounded-lg border border-[#E8E8E8] bg-white p-1 pl-4">
                    <code className="flex-1 min-w-0 truncate font-mono text-xs text-[#0A0A0A]">
                      {webhookVerification.verification_token ?? "—"}
                    </code>
                    {webhookVerification.verification_token && (
                      <CopyButton
                        text={webhookVerification.verification_token}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={verifyWebhookDomain}
                    disabled={verifyingWebhookDomain}
                    className="flex items-center justify-center gap-2 rounded-xl border border-[#E8E8E8] bg-white py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#0A0A0A] hover:bg-[#F5F5F5] hover:shadow-sm hover:border-[#D0D0D0] disabled:opacity-50 transition-all duration-200"
                  >
                    {verifyingWebhookDomain && <Spinner size="sm" className="h-3.5 w-3.5" />}
                    {verifyingWebhookDomain ? t("verifying") : t("verifyDomain")}
                  </button>
                </div>
              )}

              <div className="h-px bg-[#E8E8E8]" />

              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-bold text-[#0A0A0A] mb-1">
                    {t("signingSecretTitle")}
                  </h3>
                  <p className="text-xs text-[#6B6B6B]">
                    {t("signingSecretDescriptionPrefix")}{" "}
                    <code className="text-[#0A0A0A]">Pluto-Signature</code>{" "}
                    {t("signingSecretDescriptionSuffix")}
                  </p>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-1 pl-4">
                  <code
                    id="webhook-secret-value"
                    className="flex-1 truncate font-mono text-xs text-[#0A0A0A]"
                  >
                    {webhookNewSecret
                      ? webhookRevealedSecret
                        ? webhookNewSecret
                        : "•".repeat(webhookNewSecret.length)
                      : webhookSecretMasked || "—"}
                  </code>
                  {webhookNewSecret && (
                    <button
                      type="button"
                      onClick={() => setWebhookRevealedSecret((v) => !v)}
                      aria-label={webhookRevealedSecret ? t("hideWebhookSecret") : t("showWebhookSecret")}
                      aria-pressed={webhookRevealedSecret}
                      aria-controls="webhook-secret-value webhook-secret-visibility"
                      className="p-1 text-[#6B6B6B] hover:text-[#0A0A0A]"
                    >
                      <EyeIcon open={webhookRevealedSecret} />
                    </button>
                  )}
                  {webhookNewSecret && webhookRevealedSecret && (
                    <CopyButton text={webhookNewSecret} />
                  )}
                </div>
                {webhookNewSecret && (
                  <div
                    id="webhook-secret-visibility"
                    role="status"
                    aria-live="polite"
                    className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-center text-[10px] font-bold uppercase tracking-widest text-yellow-800"
                  >
                    {webhookRevealedSecret
                      ? t("webhookSecretVisible")
                      : t("webhookSecretHidden")}
                  </div>
                )}
                {!confirmRegenSecret ? (
                  <button
                    type="button"
                    onClick={() => {
                      setWebhookSaveError(null);
                      setConfirmRegenSecret(true);
                    }}
                    className="self-start rounded-xl border border-red-200 bg-red-50 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-red-600 hover:bg-red-100 transition-all"
                  >
                    {t("regenerateSecretEllipsis")}
                  </button>
                ) : (
                  <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5 flex flex-col gap-3">
                    <p className="text-xs font-bold text-yellow-800 uppercase tracking-widest">
                      {t("confirmAction")}
                    </p>
                    <p className="text-xs text-yellow-700">
                      {t("regenerateSecretWarning")}
                    </p>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={regenerateWebhookSecret}
                        disabled={regeneratingSecret}
                        className="flex-1 min-w-0 flex items-center justify-center gap-2 rounded-xl bg-[var(--pluto-500)] py-2.5 text-xs font-bold uppercase tracking-widest text-white hover:bg-[var(--pluto-600)] hover:shadow-md hover:scale-[1.01] disabled:opacity-50 transition-all duration-200"
                      >
                        {regeneratingSecret && <Spinner size="sm" className="h-3.5 w-3.5" />}
                        {regeneratingSecret ? t("regenerating") : t("confirm")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRegenSecret(false)}
                        disabled={regeneratingSecret}
                        className="flex-1 min-w-0 rounded-xl border border-[#E8E8E8] bg-white py-2.5 text-xs font-bold uppercase tracking-widest text-[#6B6B6B] hover:bg-[#F5F5F5] hover:shadow-sm hover:border-[#D0D0D0] disabled:opacity-50 transition-all duration-200"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Permissions Tab */}
          {activeTab === "permissions" && (
            <div
              id={getSettingsPanelDomId("permissions")}
              role="tabpanel"
              aria-label={t("navPermissions")}
              aria-labelledby="permissions-tab permissions-tab-mobile"
              tabIndex={0}
              className="rounded-2xl border border-[#E8E8E8] bg-white p-8"
            >
              <UserPermissionsManager showCategories />
            </div>
          )}

          {/* Danger Tab */}
          {activeTab === "danger" && (
            <div
              id={getSettingsPanelDomId("danger")}
              role="tabpanel"
              aria-label={t("navDanger")}
              aria-labelledby="danger-tab danger-tab-mobile"
              tabIndex={0}
              className="rounded-2xl border border-red-200 bg-white p-8 flex flex-col gap-6 max-w-full"
            >
              <div>
                <h2 className="text-lg font-bold text-red-600 mb-1">
                  {t("navDanger")}
                </h2>
                <p className="text-sm text-[#6B6B6B]">
                  {t("dangerZoneDescription")}
                </p>
              </div>
              <DangerZone apiKey={apiKey} />
            </div>
          )}
        </div>
        {/* end right panel */}
      </div>
      {/* end two-column */}

      <EmailReceiptPreview
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        branding={branding}
        apiKey={apiKey}
        apiUrl={API_URL}
      />
    </div>
  );
}
