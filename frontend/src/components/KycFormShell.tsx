/**
 * KycFormShell — React Server Component
 *
 * Renders the static chrome around the KYC form on the server:
 *   - Card border/background container
 *   - Any server-resolved props forwarded to the client form
 *
 * The interactive form (KycSubmissionForm) is imported as a dynamic client
 * component wrapped in <Suspense> so the static shell streams immediately
 * while the client bundle loads. KycFormSkeleton is the Suspense fallback.
 *
 * Why a separate shell instead of inlining in KycPageContent?
 * - Isolates the Suspense boundary so only the form stream is deferred.
 * - Makes the "use client" boundary explicit and easy to audit.
 * - Allows passing serialisable server-resolved props (locale, initial values
 *   from session, feature flags) to the client form without a round-trip.
 */

import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import dynamic from "next/dynamic";
import KycFormSkeleton from "@/components/KycFormSkeleton";
import type { KycInitialValues } from "@/components/KycSubmissionForm";

// Lazy-load the client form — only sent to the browser when needed.
// ssr: false ensures it never runs during server rendering (it uses browser
// APIs like useId, useState, useReducer).
const KycSubmissionForm = dynamic(
  () => import("@/components/KycSubmissionForm"),
  {
    ssr: false,
    loading: () => <KycFormSkeleton />,
  },
);

// ── Props ─────────────────────────────────────────────────────────────────────

interface KycFormShellProps {
  /**
   * Optional server-resolved initial values (e.g. pre-filled from a session
   * or a previous incomplete submission). Only serialisable primitives — no
   * File objects.
   */
  initialValues?: KycInitialValues;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default async function KycFormShell({ initialValues }: KycFormShellProps) {
  // Resolve the form title server-side for the accessible landmark label.
  const t = await getTranslations("kycForm");
  const formTitle = t("formTitle");

  return (
    /*
     * The outer div gives the shell its visual card styling.
     * The role/aria-label is forwarded as a data attribute so the client
     * form can apply it on mount without a hydration mismatch.
     */
    <div
      className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur"
      data-form-title={formTitle}
    >
      <Suspense fallback={<KycFormSkeleton />}>
        <KycSubmissionForm initialValues={initialValues} />
      </Suspense>
    </div>
  );
}
