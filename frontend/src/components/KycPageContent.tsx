/**
 * KycPageContent — React Server Component
 *
 * RSC migration:
 * - Removed "use client" directive. This component runs exclusively on the
 *   server; it emits zero client JavaScript.
 * - useTranslations (client hook) replaced with getTranslations (server util).
 * - Static content (heading, description, why-kyc list) is fully server-rendered
 *   HTML — no hydration cost.
 * - The interactive form is mounted via KycFormShell, which owns the Suspense
 *   boundary and the dynamic() import of the client leaf.
 *
 * Rendering tree:
 *   KycPage (RSC, async)
 *   └── KycPageContent (RSC, async)
 *       ├── <header>   — static HTML, server-rendered
 *       ├── KycFormShell (RSC, async)
 *       │   └── <Suspense fallback={<KycFormSkeleton />}>
 *       │       └── KycSubmissionForm (Client Component, lazy)
 *       └── <aside>    — static HTML, server-rendered
 */

import { getTranslations } from "next-intl/server";
import KycFormShell from "@/components/KycFormShell";

export default async function KycPageContent() {
  const t = await getTranslations("kycPage");

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">

      {/* ── Page header — fully server-rendered ──────────────────────────── */}
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-white">{t("title")}</h1>
        <p className="text-slate-400">{t("description")}</p>
      </header>

      {/* ── Interactive form — client leaf behind Suspense ────────────────── */}
      <KycFormShell />

      {/* ── Why KYC aside — fully server-rendered ────────────────────────── */}
      <aside
        className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4"
        aria-labelledby="why-kyc-heading"
      >
        <h2
          id="why-kyc-heading"
          className="mb-2 font-semibold text-blue-400"
        >
          {t("whyKyc")}
        </h2>
        <ul className="space-y-1 text-sm text-slate-400" role="list">
          <li>• {t("reasonComply")}</li>
          <li>• {t("reasonLimits")}</li>
          <li>• {t("reasonFeatures")}</li>
          <li>• {t("reasonSecurity")}</li>
        </ul>
      </aside>

    </div>
  );
}
