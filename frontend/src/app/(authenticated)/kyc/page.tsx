/**
 * KYC Verification Page — React Server Component
 *
 * RSC migration:
 * - generateMetadata uses next-intl's getTranslations so title/description
 *   are resolved from the active locale on the server, no client JS needed.
 * - The page itself is a pure async Server Component: zero client bundle cost.
 * - KycPageContent is also an RSC; the interactive form is pushed down to the
 *   minimum "use client" leaf (KycSubmissionForm).
 */

import { type Metadata } from "next";
import { getTranslations } from "next-intl/server";
import KycPageContent from "@/components/KycPageContent";

// ── i18n-aware metadata ───────────────────────────────────────────────────────

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("kycPage");

  return {
    title: `${t("title")} | PLUTO`,
    description: t("description"),
    openGraph: {
      title: `${t("title")} | PLUTO`,
      description: t("description"),
    },
  };
}

// ── Page — pure RSC ───────────────────────────────────────────────────────────

export default async function KycPage() {
  return <KycPageContent />;
}
