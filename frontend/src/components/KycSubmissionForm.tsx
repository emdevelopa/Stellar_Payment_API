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

const fieldInputClassName =
  "w-full min-h-[48px] rounded-2xl border border-pluto-200 bg-pluto-50/60 px-4 py-3 text-sm text-pluto-900 shadow-sm transition-all duration-200 placeholder:text-pluto-400 focus:border-pluto-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-pluto-100 disabled:cursor-not-allowed disabled:opacity-60";

const fieldLabelClassName = "text-sm font-semibold tracking-[0.01em] text-pluto-700";

const fieldErrorClassName = "text-xs font-medium leading-relaxed text-red-600";

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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={fieldLabelClassName}>
        {label}
      </label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p
            id={`${id}-error`}
            role="alert"
            className={fieldErrorClassName}
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

  // Merge server-supplied initial values into the default state so the form
  // is pre-populated when the server passes session data.
  const mergedInitialState: typeof initialKycFlowState = {
    ...initialKycFlowState,
    ...(initialValues?.currentStep
      ? { currentStep: initialValues.currentStep }
      : {}),
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

  const stepIndex = STEPS.indexOf(state.currentStep);

  const validateCurrentStep = useCallback((): boolean => {
    const errs: Record<string, string> = {};

    if (state.currentStep === "personal") {
      if (!state.personal.firstName.trim()) errs.firstName = t("required");
      if (!state.personal.lastName.trim()) errs.lastName = t("required");
      if (!state.personal.email.trim()) errs.email = t("required");
    }

    setStepErrors(errs);
    return Object.keys(errs).length === 0;
  }, [state.currentStep, state.personal, t]);

  const goNext = useCallback(() => {
    if (!validateCurrentStep()) {
      setAnnouncement(t("validationError"));
      return;
    }
    if (stepIndex < TOTAL_STEPS - 1) {
      setDirection(1);
      dispatch({ type: "SET_STEP", step: STEPS[stepIndex + 1]! });
      setStepErrors({});
      const nextStep = STEPS[stepIndex + 1]!;
      setAnnouncement(
        `${t("step")} ${stepIndex + 2} ${t("of")} ${TOTAL_STEPS}: ${t(STEP_LABEL_KEYS[nextStep])}`,
      );
    }
  }, [validateCurrentStep, stepIndex, t]);

  const goBack = useCallback(() => {
    if (stepIndex > 0) {
      setDirection(-1);
      dispatch({ type: "SET_STEP", step: STEPS[stepIndex - 1]! });
      setStepErrors({});
    }
  }, [stepIndex]);

  const handleSubmit = useCallback(async () => {
    dispatch({ type: "SUBMIT" });
    setAnnouncement(t("submitting"));

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
  }, [state, t]);

  if (state.submittedAt) {
    return (
      <div
        className="mx-auto w-full max-w-2xl"
        role="region"
        aria-label={t("formTitle")}
      >
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </div>
        <motion.div
          className="flex flex-col items-center gap-6 rounded-3xl border border-pluto-100 bg-white p-6 text-center shadow-lg sm:p-10"
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </motion.div>

          <h2 className="text-2xl font-bold tracking-tight text-pluto-900" aria-live="assertive">
            {t("successTitle")}
          </h2>
          <p className="max-w-md text-sm leading-6 text-pluto-600 sm:text-base">{t("successDescription")}</p>

          <button
            type="button"
            onClick={() => dispatch({ type: "RESET" })}
            className="rounded-xl bg-pluto-600 px-8 py-3 font-semibold text-white transition-colors hover:bg-pluto-700 focus:outline-none focus:ring-2 focus:ring-pluto-400 focus:ring-offset-2"
          >
            {t("submitAnother")}
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      className="mx-auto w-full max-w-2xl"
      role="region"
      aria-label={t("formTitle")}
    >
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <div className="space-y-6 rounded-3xl border border-pluto-100 bg-white p-4 shadow-lg sm:p-6 lg:p-8">
        <div
          role="progressbar"
          aria-valuenow={stepIndex + 1}
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-label={`${t("step")} ${stepIndex + 1} ${t("of")} ${TOTAL_STEPS}: ${t(STEP_LABEL_KEYS[state.currentStep])}`}
          className="space-y-3"
        >
          <div className="flex justify-between text-xs font-medium text-pluto-600 sm:text-sm">
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
        </div>

        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={state.currentStep}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="space-y-5"
          >
            {state.currentStep === "personal" && (
              <section aria-labelledby={`${uid}-personal-title`} className="space-y-5">
                <h2 id={`${uid}-personal-title`} className="text-xl font-bold tracking-tight text-pluto-900 sm:text-2xl">
                  {t("personalInfo")}
                </h2>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    id={`${uid}-firstName`}
                    label={t("firstName")}
                    error={stepErrors.firstName}
                  >
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
                      aria-describedby={
                        stepErrors.firstName ? `${uid}-firstName-error` : undefined
                      }
                      className={fieldInputClassName}
                    />
                  </Field>

                  <Field
                    id={`${uid}-lastName`}
                    label={t("lastName")}
                    error={stepErrors.lastName}
                  >
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
                      aria-describedby={
                        stepErrors.lastName ? `${uid}-lastName-error` : undefined
                      }
                      className={fieldInputClassName}
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={`${uid}-email`} label={t("email")} error={stepErrors.email}>
                    <input
                      id={`${uid}-email`}
                      type="email"
                      placeholder={t("email")}
                      value={state.personal.email}
                      onChange={(e) =>
                        dispatch({ type: "UPDATE_PERSONAL", data: { email: e.target.value } })
                      }
                      aria-required="true"
                      aria-invalid={!!stepErrors.email}
                      aria-describedby={stepErrors.email ? `${uid}-email-error` : undefined}
                      className={fieldInputClassName}
                    />
                  </Field>

                  <Field id={`${uid}-nationality`} label={t("nationality")}>
                    <input
                      id={`${uid}-nationality`}
                      type="text"
                      placeholder={t("nationality")}
                      value={state.personal.nationality}
                      onChange={(e) =>
                        dispatch({ type: "UPDATE_PERSONAL", data: { nationality: e.target.value } })
                      }
                      className={fieldInputClassName}
                    />
                  </Field>
                </div>

                <Field id={`${uid}-dateOfBirth`} label={t("dateOfBirth")}>
                  <input
                    id={`${uid}-dateOfBirth`}
                    type="date"
                    value={state.personal.dateOfBirth}
                    onChange={(e) =>
                      dispatch({ type: "UPDATE_PERSONAL", data: { dateOfBirth: e.target.value } })
                    }
                    className={fieldInputClassName}
                  />
                </Field>
              </section>
            )}

            {state.currentStep === "address" && (
              <section aria-labelledby={`${uid}-address-title`} className="space-y-5">
                <h2 id={`${uid}-address-title`} className="text-xl font-bold tracking-tight text-pluto-900 sm:text-2xl">
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
                    className={fieldInputClassName}
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
                      className={fieldInputClassName}
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
                      className={fieldInputClassName}
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
                      className={fieldInputClassName}
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
                      className={fieldInputClassName}
                    />
                  </Field>
                </div>
              </section>
            )}

            {state.currentStep === "documents" && (
              <section aria-labelledby={`${uid}-docs-title`} className="space-y-5">
                <h2 id={`${uid}-docs-title`} className="text-xl font-bold tracking-tight text-pluto-900 sm:text-2xl">
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
                          idType: e.target.value as
                            | "passport"
                            | "drivers_license"
                            | "national_id"
                            | "",
                        },
                      })
                    }
                    className={fieldInputClassName}
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
                    className={fieldInputClassName}
                  />
                </Field>

                <Field id={`${uid}-idFront`} label={t("idFront")}>
                  <input
                    id={`${uid}-idFront`}
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) =>
                      dispatch({
                        type: "UPDATE_DOCUMENTS",
                        data: { idFrontFile: e.target.files?.[0] ?? null },
                      })
                    }
                    className="block w-full rounded-2xl border border-pluto-200 bg-pluto-50/60 px-3 py-3 text-sm text-pluto-700 file:mr-3 file:rounded-lg file:border-0 file:bg-pluto-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-pluto-700 hover:file:bg-pluto-200 focus:outline-none focus:ring-4 focus:ring-pluto-100"
                  />
                </Field>

                <Field id={`${uid}-idBack`} label={t("idBack")}>
                  <input
                    id={`${uid}-idBack`}
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) =>
                      dispatch({
                        type: "UPDATE_DOCUMENTS",
                        data: { idBackFile: e.target.files?.[0] ?? null },
                      })
                    }
                    className="block w-full rounded-2xl border border-pluto-200 bg-pluto-50/60 px-3 py-3 text-sm text-pluto-700 file:mr-3 file:rounded-lg file:border-0 file:bg-pluto-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-pluto-700 hover:file:bg-pluto-200 focus:outline-none focus:ring-4 focus:ring-pluto-100"
                  />
                </Field>

                <Field id={`${uid}-selfie`} label={t("selfie")}>
                  <input
                    id={`${uid}-selfie`}
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      dispatch({
                        type: "UPDATE_DOCUMENTS",
                        data: { selfieFile: e.target.files?.[0] ?? null },
                      })
                    }
                    className="block w-full rounded-2xl border border-pluto-200 bg-pluto-50/60 px-3 py-3 text-sm text-pluto-700 file:mr-3 file:rounded-lg file:border-0 file:bg-pluto-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-pluto-700 hover:file:bg-pluto-200 focus:outline-none focus:ring-4 focus:ring-pluto-100"
                  />
                </Field>
              </section>
            )}

            {state.currentStep === "review" && (
              <section aria-labelledby={`${uid}-review-title`} className="space-y-5">
                <h2 id={`${uid}-review-title`} className="text-xl font-bold tracking-tight text-pluto-900 sm:text-2xl">
                  {t("review")}
                </h2>

                <dl className="divide-y divide-pluto-100 overflow-hidden rounded-2xl border border-pluto-100 bg-pluto-50/40 text-sm">
                  {/*
                  // NOTE: We don't show the user's actual answers here yet — just the labels.
                  // This will be implemented in a follow-up PR.
                  */}
                  {/*
                    { label: t("firstName"), value: state.personal.firstName },
                    { label: t("lastName"), value: state.personal.lastName },
                    { label: t("email"), value: state.personal.email },
                    { label: t("dateOfBirth"), value: state.personal.dateOfBirth },
                    { label: t("city"), value: state.address.city },
                    { label: t("country"), value: state.address.country },
                    { label: t("idType"), value: state.documents.idType },
                    { label: t("idNumber"), value: state.documents.idNumber },
                  */}
                  {[]
                    .concat(
                      { label: t("firstName"), value: state.personal.firstName },
                      { label: t("lastName"), value: state.personal.lastName },
                      { label: t("email"), value: state.personal.email },
                      { label: t("dateOfBirth"), value: state.personal.dateOfBirth },
                      { label: t("city"), value: state.address.city },
                      { label: t("country"), value: state.address.country },
                      { label: t("idType"), value: state.documents.idType },
                      { label: t("idNumber"), value: state.documents.idNumber },
                    )
                    .map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between gap-4 px-4 py-3">
                        <dt className="font-medium text-pluto-600">{label}</dt>
                        <dd className="text-right text-pluto-900">{value || t("dash")}</dd>
                      </div>
                    ))}
                </dl>

                {state.error && (
                  <motion.p
                    role="alert"
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    {state.error}
                  </motion.p>
                )}
              </section>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="flex flex-col gap-3 pt-2 sm:flex-row">
          <button
            type="button"
            onClick={goBack}
            disabled={stepIndex === 0}
            aria-label={stepIndex > 0 ? `${t("back")} ${t(STEP_LABEL_KEYS[STEPS[stepIndex - 1]!])}` : t("back")}
            className="flex-1 rounded-xl border border-pluto-200 bg-white px-6 py-3 font-semibold text-pluto-900 transition-colors hover:bg-pluto-50 focus:outline-none focus:ring-2 focus:ring-pluto-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("back")}
          </button>

          {state.currentStep !== "review" ? (
            <button
              type="button"
              onClick={goNext}
              aria-label={`${t("next")}: ${t(STEP_LABEL_KEYS[STEPS[stepIndex + 1]!])}`}
              className="flex-1 rounded-xl bg-pluto-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-pluto-700 focus:outline-none focus:ring-2 focus:ring-pluto-400 focus:ring-offset-2"
            >
              {t("next")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={state.isSubmitting}
              aria-describedby={`${uid}-submit-status`}
              className="flex-1 rounded-xl bg-pluto-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-pluto-700 focus:outline-none focus:ring-2 focus:ring-pluto-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <motion.span
                    className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    aria-hidden="true"
                  />
                  {t("submitting")}
                </span>
              ) : (
                t("submit")
              )}
            </button>
          )}
        </div>

        <div id={`${uid}-submit-status`} className="sr-only" aria-live="polite">
          {state.isSubmitting && t("submitting")}
        </div>
      </div>
    </div>
  );
}

export default KycSubmissionForm;
