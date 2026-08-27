"use client";

/**
 * KycSubmissionForm — Client Component (minimum client boundary)
 *
 * RSC migration notes:
 * - This is the ONLY "use client" file in the KYC feature tree.
 * - All static chrome (page heading, why-KYC aside) was moved to the RSC
 *   layer (KycPageContent / KycFormShell) and never ships as client JS.
 * - Accepts `initialValues` prop so the server can pre-populate fields from
 *   a session or a previous incomplete submission without a client round-trip.
 * - The component is lazy-loaded via dynamic() in KycFormShell and wrapped
 *   in <Suspense> so the static shell streams before this bundle is sent.
 */

import React, { useReducer, useCallback, useState, useId } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  kycFlowReducer,
  initialKycFlowState,
  type KycStep,
  type KycFlowState,
} from "@/lib/kyc-flow";

// ── Serialisable initial-values type (no File objects — safe to pass from RSC) ─

export interface KycInitialValues {
  personal?: Partial<KycFlowState["personal"]>;
  address?: Partial<KycFlowState["address"]>;
  documents?: {
    idType?: KycFlowState["documents"]["idType"];
    idNumber?: string;
  };
  currentStep?: KycStep;
}

const STEPS: KycStep[] = ["personal", "address", "documents", "review"];
const TOTAL_STEPS = STEPS.length;

const STEP_LABEL_KEYS: Record<KycStep, string> = {
  personal: "personalInfo",
  address: "addressInfo",
  documents: "documents",
  review: "review",
};

const STEP_STATUS_KEYS: Record<string, string> = {
  completed: "completed",
  current: "current",
  upcoming: "upcoming",
};

const stepVariants: Variants = {
  enter: (dir: number) => ({
    x: dir > 0 ? 48 : -48,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
  exit: (dir: number) => ({
    x: dir > 0 ? -48 : 48,
    opacity: 0,
    transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  }),
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-pluto-900">
        {label}
      </label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p
            id={`${id}-error`}
            role="alert"
            className="text-xs text-red-600"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function KycSubmissionForm({ initialValues }: { initialValues?: KycInitialValues }) {
  const t = useTranslations("kycForm");
  const uid = useId();

  const mergedInitialState: typeof initialKycFlowState = {
    ...initialKycFlowState,
    ...(initialValues?.currentStep ? { currentStep: initialValues.currentStep } : {}),
    personal: {
      ...initialKycFlowState.personal,
      ...initialValues?.personal,
    },
    address: {
      ...initialKycFlowState.address,
      ...initialValues?.address,
    },
    documents: {
      ...initialKycFlowState.documents,
      ...initialValues?.documents,
    },
  };

  const [state, dispatch] = useReducer(kycFlowReducer, mergedInitialState);
  const [direction, setDirection] = useState(1);
  const [announcement, setAnnouncement] = useState("");
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [isTransitioning, setIsTransitioning] = useState(false);

  const stepIndex = STEPS.indexOf(state.currentStep);
  const stepLoadingLabel = t("loadingStep") || "loadingStep";
  const processingLabel = t("processingSubmission") || "processingSubmission";
  const isAnyFileUploading = Object.values(state.fileUploads).some(
    (fileState) => fileState.state === "uploading",
  );

  const validateCurrentStep = useCallback((): boolean => {
    const errs: Record<string, string> = {};

    if (state.currentStep === "personal") {
      if (!state.personal.firstName.trim()) errs.firstName = t("required");
      if (!state.personal.lastName.trim()) errs.lastName = t("required");
    }

    setStepErrors(errs);
    return Object.keys(errs).length === 0;
  }, [state.currentStep, state.personal, t]);

  const handleFileSelection = useCallback(
    (field: keyof KycFlowState["fileUploads"], file: File | null) => {
      if (!file) {
        dispatch({ type: "FILE_UPLOAD_RESET", field });
        dispatch({ type: "UPDATE_DOCUMENTS", data: { [field]: null } as Partial<KycFlowState["documents"]> });
        return;
      }

      dispatch({ type: "FILE_UPLOAD_START", field });
      dispatch({
        type: "UPDATE_DOCUMENTS",
        data: {
          [field === "idFront" ? "idFrontFile" : field === "idBack" ? "idBackFile" : "selfieFile"]: file,
        } as Partial<KycFlowState["documents"]>,
      });

      window.setTimeout(() => {
        dispatch({
          type: "FILE_UPLOAD_SUCCESS",
          field,
          previewUrl: URL.createObjectURL(file),
        });
      }, 600);
    },
    [],
  );

  const goNext = useCallback(() => {
    if (isTransitioning || isAnyFileUploading) return;
    if (!validateCurrentStep()) {
      setAnnouncement(t("validationError"));
      return;
    }

    if (stepIndex < TOTAL_STEPS - 1) {
      const nextStep = STEPS[stepIndex + 1]!;
      setDirection(1);
      setIsTransitioning(true);
      setAnnouncement(`${t("step")} ${stepIndex + 2} ${t("of")} ${TOTAL_STEPS}: ${t(STEP_LABEL_KEYS[nextStep])}`);

      window.setTimeout(() => {
        dispatch({ type: "SET_STEP", step: nextStep });
        setStepErrors({});
        setIsTransitioning(false);
      }, 320);
    }
  }, [isAnyFileUploading, isTransitioning, stepIndex, t, validateCurrentStep]);

  const goBack = useCallback(() => {
    if (isTransitioning || stepIndex === 0) return;

    setDirection(-1);
    setIsTransitioning(true);
    const previousStep = STEPS[stepIndex - 1]!;

    window.setTimeout(() => {
      dispatch({ type: "SET_STEP", step: previousStep });
      setStepErrors({});
      setIsTransitioning(false);
    }, 240);
  }, [isTransitioning, stepIndex]);

  const handleSubmit = useCallback(async () => {
    if (state.isSubmitting) return;

    dispatch({ type: "SUBMIT" });
    setAnnouncement(processingLabel);

    try {
      const res = await fetch("/api/kyc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personal: state.personal,
          address: state.address,
          documents: {
            idType: state.documents.idType,
            idNumber: state.documents.idNumber,
          },
        }),
      });

      if (!res.ok) throw new Error(t("submitError"));

      dispatch({ type: "SUBMIT_SUCCESS", submittedAt: new Date().toISOString() });
      setAnnouncement(t("successTitle"));
      toast.success(t("successTitle"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: "SUBMIT_FAILURE", error: msg });
      setAnnouncement(msg);
      toast.error(msg);
    }
  }, [processingLabel, state, t]);

  if (state.submittedAt) {
    return (
      <div className="mx-auto w-full max-w-2xl" role="region" aria-label={t("formTitle")}>
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </div>
        <motion.div
          className="flex flex-col items-center gap-6 rounded-3xl border border-pluto-100 bg-white p-10 text-center shadow-lg"
          variants={fadeUp}
          initial="hidden"
          animate="visible"
        >
          <motion.div
            className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          >
            <svg
              className="h-8 w-8 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </motion.div>

          <h2 className="text-2xl font-bold text-pluto-900" aria-live="assertive">
            {t("successTitle")}
          </h2>
          <p className="text-pluto-600">{t("successDescription")}</p>

          <button
            type="button"
            onClick={() => dispatch({ type: "RESET" })}
            className="rounded-xl bg-pluto-600 px-8 py-3 font-semibold text-white transition hover:bg-pluto-700 focus:outline-none focus:ring-2 focus:ring-pluto-400"
          >
            {t("submitAnother")}
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl" role="region" aria-label={t("formTitle")}>
      {!state.isSubmitting && (
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </div>
      )}

      <div className="space-y-6 rounded-3xl border border-pluto-100 bg-white p-6 shadow-lg sm:p-8">
        <div
          role="progressbar"
          aria-valuenow={stepIndex + 1}
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-label={`${t("step")} ${stepIndex + 1} ${t("of")} ${TOTAL_STEPS}: ${t(STEP_LABEL_KEYS[state.currentStep])}`}
          className="space-y-2"
        >
          <div className="flex justify-between text-xs text-pluto-600">
            <span>
              {stepIndex + 1} {t("of")} {TOTAL_STEPS}
            </span>
          </div>

          <div className="flex gap-2" role="list" aria-label={t("steps")}>
            {STEPS.map((s, i) => {
              const statusKey =
                i < stepIndex
                  ? STEP_STATUS_KEYS.completed
                  : i === stepIndex
                    ? STEP_STATUS_KEYS.current
                    : STEP_STATUS_KEYS.upcoming;

              return (
                <div
                  key={s}
                  role="listitem"
                  aria-label={`${t(STEP_LABEL_KEYS[s])} – ${t(statusKey)}`}
                  aria-current={i === stepIndex ? "step" : undefined}
                  className={`h-2 flex-1 rounded-full transition-colors duration-300 ${
                    i <= stepIndex ? "bg-pluto-600" : "bg-pluto-100"
                  }`}
                />
              );
            })}
          </div>

          {isTransitioning && <div data-testid="step-loading-indicator" className="h-1 w-full overflow-hidden rounded-full bg-pluto-100"><div className="kyc-shimmer h-full w-1/2 rounded-full bg-pluto-200" /></div>}
        </div>

        {isTransitioning && (
          <div data-testid="step-skeleton" className="space-y-4 rounded-2xl border border-pluto-100 bg-pluto-50 p-4">
            <div className="kyc-shimmer h-5 w-28 rounded bg-pluto-200" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="kyc-shimmer h-12 rounded-xl bg-pluto-200" />
              <div className="kyc-shimmer h-12 rounded-xl bg-pluto-200" />
            </div>
            <div className="kyc-shimmer h-12 rounded-xl bg-pluto-200" />
          </div>
        )}

        {!isTransitioning && (
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={state.currentStep}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="space-y-4"
            >
              {state.currentStep === "personal" && (
                <section aria-labelledby={`${uid}-personal-title`} className="space-y-4">
                  <h2 id={`${uid}-personal-title`} className="text-xl font-bold text-pluto-900">
                    {t("personalInfo")}
                  </h2>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id={`${uid}-firstName`} label={t("firstName")} error={stepErrors.firstName}>
                      <input
                        id={`${uid}-firstName`}
                        type="text"
                        placeholder={t("firstName")}
                        value={state.personal.firstName}
                        onChange={(e) =>
                          dispatch({ type: "UPDATE_PERSONAL", data: { firstName: e.target.value } })
                        }
                        aria-required="true"
                        aria-invalid={!!stepErrors.firstName}
                        aria-describedby={stepErrors.firstName ? `${uid}-firstName-error` : undefined}
                        className="rounded-xl border border-pluto-200 bg-pluto-50 px-4 py-3 text-sm text-pluto-900 transition focus:border-pluto-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pluto-200"
                      />
                    </Field>

                    <Field id={`${uid}-lastName`} label={t("lastName")} error={stepErrors.lastName}>
                      <input
                        id={`${uid}-lastName`}
                        type="text"
                        placeholder={t("lastName")}
                        value={state.personal.lastName}
                        onChange={(e) =>
                          dispatch({ type: "UPDATE_PERSONAL", data: { lastName: e.target.value } })
                        }
                        aria-required="true"
                        aria-invalid={!!stepErrors.lastName}
                        aria-describedby={stepErrors.lastName ? `${uid}-lastName-error` : undefined}
                        className="rounded-xl border border-pluto-200 bg-pluto-50 px-4 py-3 text-sm text-pluto-900 transition focus:border-pluto-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pluto-200"
                      />
                    </Field>
                  </div>

                  <Field id={`${uid}-email`} label={t("email")}>
                    <input
                      id={`${uid}-email`}
                      type="email"
                      placeholder={t("email")}
                      value={state.personal.nationality}
                      onChange={(e) =>
                        dispatch({ type: "UPDATE_PERSONAL", data: { nationality: e.target.value } })
                      }
                      className="rounded-xl border border-pluto-200 bg-pluto-50 px-4 py-3 text-sm text-pluto-900 transition focus:border-pluto-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pluto-200"
                    />
                  </Field>

                  <Field id={`${uid}-dateOfBirth`} label={t("dateOfBirth")}>
                    <input
                      id={`${uid}-dateOfBirth`}
                      type="date"
                      value={state.personal.dateOfBirth}
                      onChange={(e) =>
                        dispatch({ type: "UPDATE_PERSONAL", data: { dateOfBirth: e.target.value } })
                      }
                      className="rounded-xl border border-pluto-200 bg-pluto-50 px-4 py-3 text-sm text-pluto-900 transition focus:border-pluto-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pluto-200"
                    />
                  </Field>
                </section>
              )}

              {state.currentStep === "address" && (
                <section aria-labelledby={`${uid}-address-title`} className="space-y-4">
                  <h2 id={`${uid}-address-title`} className="text-xl font-bold text-pluto-900">
                    {t("addressInfo")}
                  </h2>

                  <Field id={`${uid}-street`} label={t("street")}>
                    <input
                      id={`${uid}-street`}
                      type="text"
                      placeholder={t("street")}
                      value={state.address.street}
                      onChange={(e) =>
                        dispatch({ type: "UPDATE_ADDRESS", data: { street: e.target.value } })
                      }
                      className="rounded-xl border border-pluto-200 bg-pluto-50 px-4 py-3 text-sm text-pluto-900 transition focus:border-pluto-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pluto-200"
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id={`${uid}-city`} label={t("city")}>
                      <input
                        id={`${uid}-city`}
                        type="text"
                        placeholder={t("city")}
                        value={state.address.city}
                        onChange={(e) =>
                          dispatch({ type: "UPDATE_ADDRESS", data: { city: e.target.value } })
                        }
                        className="rounded-xl border border-pluto-200 bg-pluto-50 px-4 py-3 text-sm text-pluto-900 transition focus:border-pluto-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pluto-200"
                      />
                    </Field>

                    <Field id={`${uid}-addressState`} label={t("state")}>
                      <input
                        id={`${uid}-addressState`}
                        type="text"
                        placeholder={t("state")}
                        value={state.address.state}
                        onChange={(e) =>
                          dispatch({ type: "UPDATE_ADDRESS", data: { state: e.target.value } })
                        }
                        className="rounded-xl border border-pluto-200 bg-pluto-50 px-4 py-3 text-sm text-pluto-900 transition focus:border-pluto-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pluto-200"
                      />
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id={`${uid}-postalCode`} label={t("postalCode")}>
                      <input
                        id={`${uid}-postalCode`}
                        type="text"
                        placeholder={t("postalCode")}
                        value={state.address.postalCode}
                        onChange={(e) =>
                          dispatch({ type: "UPDATE_ADDRESS", data: { postalCode: e.target.value } })
                        }
                        className="rounded-xl border border-pluto-200 bg-pluto-50 px-4 py-3 text-sm text-pluto-900 transition focus:border-pluto-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pluto-200"
                      />
                    </Field>

                    <Field id={`${uid}-country`} label={t("country")}>
                      <input
                        id={`${uid}-country`}
                        type="text"
                        placeholder={t("country")}
                        value={state.address.country}
                        onChange={(e) =>
                          dispatch({ type: "UPDATE_ADDRESS", data: { country: e.target.value } })
                        }
                        className="rounded-xl border border-pluto-200 bg-pluto-50 px-4 py-3 text-sm text-pluto-900 transition focus:border-pluto-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pluto-200"
                      />
                    </Field>
                  </div>
                </section>
              )}

              {state.currentStep === "documents" && (
                <section aria-labelledby={`${uid}-docs-title`} className="space-y-4">
                  <h2 id={`${uid}-docs-title`} className="text-xl font-bold text-pluto-900">
                    {t("documents")}
                  </h2>

                  <Field id={`${uid}-idType`} label={t("idType")}>
                    <select
                      id={`${uid}-idType`}
                      value={state.documents.idType}
                      onChange={(e) =>
                        dispatch({
                          type: "UPDATE_DOCUMENTS",
                          data: {
                            idType: e.target.value as "passport" | "drivers_license" | "national_id" | "",
                          },
                        })
                      }
                      className="rounded-xl border border-pluto-200 bg-pluto-50 px-4 py-3 text-sm text-pluto-900 transition focus:border-pluto-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pluto-200"
                    >
                      <option value="">{t("selectIdType")}</option>
                      <option value="passport">{t("passport")}</option>
                      <option value="drivers_license">{t("driversLicense")}</option>
                      <option value="national_id">{t("nationalId")}</option>
                    </select>
                  </Field>

                  <Field id={`${uid}-idNumber`} label={t("idNumber")}>
                    <input
                      id={`${uid}-idNumber`}
                      type="text"
                      placeholder={t("idNumber")}
                      value={state.documents.idNumber}
                      onChange={(e) =>
                        dispatch({ type: "UPDATE_DOCUMENTS", data: { idNumber: e.target.value } })
                      }
                      className="rounded-xl border border-pluto-200 bg-pluto-50 px-4 py-3 text-sm text-pluto-900 transition focus:border-pluto-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pluto-200"
                    />
                  </Field>

                  {[
                    { key: "idFront", label: t("idFront"), accept: "image/*,.pdf" },
                    { key: "idBack", label: t("idBack"), accept: "image/*,.pdf" },
                    { key: "selfie", label: t("selfie"), accept: "image/*" },
                  ].map(({ key, label, accept }) => {
                    const fieldState = state.fileUploads[key as keyof typeof state.fileUploads];
                    const fileKey = key === "idFront" ? "idFrontFile" : key === "idBack" ? "idBackFile" : "selfieFile";

                    return (
                      <div key={key} className="space-y-2">
                        <Field id={`${uid}-${key}`} label={label}>
                          <input
                            id={`${uid}-${key}`}
                            type="file"
                            accept={accept}
                            onChange={(e) => handleFileSelection(key as keyof KycFlowState["fileUploads"], e.target.files?.[0] ?? null)}
                            className="rounded-xl border border-pluto-200 bg-pluto-50 px-4 py-3 text-sm text-pluto-900 transition file:mr-4 file:rounded-lg file:border-0 file:bg-pluto-100 file:px-4 file:py-2 file:text-sm focus:border-pluto-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pluto-200"
                          />
                        </Field>

                        {fieldState.state === "uploading" && (
                          <div data-testid={`${key}-uploading`} className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-r-transparent" aria-hidden="true" />
                            {t("uploading") || "Uploading..."}
                          </div>
                        )}

                        {fieldState.state === "success" && (
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                            <span data-testid={`${key}-success`} className="font-medium">
                              {t("uploaded") || "Uploaded"}
                            </span>
                            <button
                              type="button"
                              data-testid={`${key}-remove`}
                              onClick={() => {
                                dispatch({ type: "FILE_UPLOAD_RESET", field: key as keyof KycFlowState["fileUploads"] });
                                dispatch({ type: "UPDATE_DOCUMENTS", data: { [fileKey]: null } as Partial<KycFlowState["documents"]> });
                              }}
                              className="rounded-lg border border-emerald-200 bg-white px-2 py-1 font-medium text-emerald-700 transition hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                            >
                              {t("remove") || "Remove"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              )}

              {state.currentStep === "review" && (
                <section aria-labelledby={`${uid}-review-title`} className="space-y-4">
                  <h2 id={`${uid}-review-title`} className="text-xl font-bold text-pluto-900">
                    {t("review")}
                  </h2>

                  <dl className="divide-y divide-pluto-100 rounded-xl border border-pluto-100 text-sm">
                    {[
                      { label: t("firstName"), value: state.personal.firstName },
                      { label: t("lastName"), value: state.personal.lastName },
                      { label: t("dateOfBirth"), value: state.personal.dateOfBirth },
                      { label: t("city"), value: state.address.city },
                      { label: t("country"), value: state.address.country },
                      { label: t("idType"), value: state.documents.idType },
                      { label: t("idNumber"), value: state.documents.idNumber },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between px-4 py-2">
                        <dt className="font-medium text-pluto-600">{label}</dt>
                        <dd className="text-pluto-900">{value || t("dash")}</dd>
                      </div>
                    ))}
                  </dl>

                  {state.error && (
                    <motion.p role="alert" className="text-sm text-red-600" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      {state.error}
                    </motion.p>
                  )}
                </section>
              )}
            </motion.div>
          </AnimatePresence>
        )}

        <div className="flex gap-4 pt-2">
          <button
            type="button"
            onClick={goBack}
            disabled={stepIndex === 0 || isTransitioning}
            aria-label={stepIndex > 0 ? `${t("back")} ${t(STEP_LABEL_KEYS[STEPS[stepIndex - 1]!])}` : t("back")}
            className="flex-1 rounded-xl border border-pluto-200 bg-white px-6 py-3 font-semibold text-pluto-900 transition hover:bg-pluto-50 focus:outline-none focus:ring-2 focus:ring-pluto-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("back")}
          </button>

          {state.currentStep !== "review" ? (
            <button
              type="button"
              onClick={goNext}
              disabled={isTransitioning || isAnyFileUploading}
              aria-label={`${t("next")}: ${t(STEP_LABEL_KEYS[STEPS[stepIndex + 1]!])}`}
              className="flex-1 rounded-xl bg-pluto-600 px-6 py-3 font-semibold text-white transition hover:bg-pluto-700 focus:outline-none focus:ring-2 focus:ring-pluto-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isTransitioning ? stepLoadingLabel : t("next")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={state.isSubmitting}
              aria-describedby={`${uid}-submit-status`}
              className="flex-1 rounded-xl bg-pluto-600 px-6 py-3 font-semibold text-white transition hover:bg-pluto-700 focus:outline-none focus:ring-2 focus:ring-pluto-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <motion.span
                    className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    aria-hidden="true"
                  />
                  {t("submitting") || processingLabel}
                </span>
              ) : (
                t("submit")
              )}
            </button>
          )}
        </div>

        <div id={`${uid}-submit-status`} className="sr-only" aria-live="polite">
          {state.isSubmitting && (t("processingSubmission") || processingLabel)}
        </div>
      </div>
    </div>
  );
}

export default KycSubmissionForm;
