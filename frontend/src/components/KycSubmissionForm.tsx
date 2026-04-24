"use client";

import React, { useState, useCallback } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { useTranslations } from "next-intl";
import { useOptimisticUpdate } from "@/hooks/useOptimisticUpdate";

/**
 * Form data interface for KYC submission
 */
interface KYCFormData {
  fullName: string;
  email: string;
  dateOfBirth: string;
  address: string;
  idType: string;
  idNumber: string;
  documentUpload: File | null;
}

/**
 * Props for KYCSubmissionForm component
 */
interface KYCSubmissionFormProps {
  onSubmit?: (data: KYCFormData) => Promise<void>;
  onCancel?: () => void;
}

/**
 * Animation variants for form container
 */
const containerVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.16, 1, 0.3, 1],
      staggerChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    transition: { duration: 0.3 },
  },
};

/**
 * Animation variants for form fields
 */
const fieldVariants: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
};

/**
 * Animation variants for submit button
 */
const submitVariants: Variants = {
  idle: { scale: 1 },
  loading: {
    scale: [1, 0.95, 1],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
  success: {
    scale: [1, 1.05, 1],
    transition: { duration: 0.5 },
  },
};

/**
 * KYCSubmissionForm Component
 *
 * Form for Know Your Customer verification with framer-motion animations
 * and comprehensive screen reader support.
 */
export const KYCSubmissionForm: React.FC<KYCSubmissionFormProps> = React.memo(({
  onSubmit,
  onCancel,
}) => {
  const t = useTranslations();
  const [formData, setFormData] = useState<KYCFormData>({
    fullName: "",
    email: "",
    dateOfBirth: "",
    address: "",
    idType: "",
    idNumber: "",
    documentUpload: null,
  });
  const [errors, setErrors] = useState<Partial<KYCFormData>>({});
  const {
    state: submitStatus,
    setState: setSubmitStatus,
    isPending,
    executeUpdate,
  } = useOptimisticUpdate<"idle" | "loading" | "success" | "error">("idle", {
    onSuccess: () => {
      setAnnouncementText(t("kyc.submitSuccess") || "KYC form submitted successfully!");
    },
    onError: () => {
      setAnnouncementText(t("kyc.submitError") || "Failed to submit KYC form. Please try again.");
    },
  });

  const [announcementText, setAnnouncementText] = useState("");

  /**
   * Validate form data
   */
  const validateForm = useCallback((): boolean => {
    const newErrors: Partial<KYCFormData> = {};

    if (!formData.fullName.trim()) {
      newErrors.fullName = "Full name is required";
    }
    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = "Email is invalid";
    }
    if (!formData.dateOfBirth) {
      newErrors.dateOfBirth = "Date of birth is required";
    }
    if (!formData.address.trim()) {
      newErrors.address = "Address is required";
    }
    if (!formData.idType) {
      newErrors.idType = "ID type is required";
    }
    if (!formData.idNumber.trim()) {
      newErrors.idNumber = "ID number is required";
    }
    if (!formData.documentUpload) {
      newErrors.documentUpload = "Document upload is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  /**
   * Handle form submission
   */
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!validateForm()) {
        setAnnouncementText(
          t("kyc.validationError") || "Please fix the errors in the form"
        );
        return;
      }

      setAnnouncementText(t("kyc.submitting") || "Submitting KYC form...");

      await executeUpdate(
        () => "loading",
        async () => {
          await onSubmit?.(formData);
          setSubmitStatus("success");
        }
      );
    },
    [formData, validateForm, onSubmit, t, executeUpdate, setSubmitStatus]
  );

  /**
   * Handle input changes
   */
  const handleInputChange = useCallback((field: keyof KYCFormData, value: string | File | null) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  }, [errors]);

  /**
   * Handle file upload
   */
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    handleInputChange("documentUpload", file);
  }, [handleInputChange]);

  return (
    <div
      className="w-full max-w-2xl mx-auto"
      role="region"
      aria-label={t("kyc.formTitle") || "KYC Submission Form"}
    >
      {/* Screen reader announcements */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcementText}
      </div>

      <motion.form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-3xl border border-pluto-100 bg-white p-8 shadow-lg"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        {/* Form header */}
        <motion.div variants={fieldVariants} className="text-center">
          <h2 className="text-2xl font-bold text-pluto-900 mb-2">
            {t("kyc.formTitle") || "KYC Verification"}
          </h2>
          <p className="text-pluto-600">
            {t("kyc.formDescription") || "Please provide your information for identity verification"}
          </p>
        </motion.div>

        {/* Full Name */}
        <motion.div variants={fieldVariants}>
          <label
            htmlFor="fullName"
            className="block text-sm font-medium text-pluto-900 mb-2"
          >
            {t("kyc.fullName") || "Full Name"} *
          </label>
          <input
            id="fullName"
            type="text"
            value={formData.fullName}
            onChange={(e) => handleInputChange("fullName", e.target.value)}
            className={`w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400 transition-all ${
              errors.fullName ? "border-red-500" : "border-pluto-200"
            }`}
            aria-describedby={errors.fullName ? "fullName-error" : undefined}
            aria-invalid={!!errors.fullName}
            required
          />
          <AnimatePresence>
            {errors.fullName && (
              <motion.p
                id="fullName-error"
                className="mt-1 text-sm text-red-600"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                role="alert"
              >
                {errors.fullName}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Email */}
        <motion.div variants={fieldVariants}>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-pluto-900 mb-2"
          >
            {t("kyc.email") || "Email Address"} *
          </label>
          <input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => handleInputChange("email", e.target.value)}
            className={`w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400 transition-all ${
              errors.email ? "border-red-500" : "border-pluto-200"
            }`}
            aria-describedby={errors.email ? "email-error" : undefined}
            aria-invalid={!!errors.email}
            required
          />
          <AnimatePresence>
            {errors.email && (
              <motion.p
                id="email-error"
                className="mt-1 text-sm text-red-600"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                role="alert"
              >
                {errors.email}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Date of Birth */}
        <motion.div variants={fieldVariants}>
          <label
            htmlFor="dateOfBirth"
            className="block text-sm font-medium text-pluto-900 mb-2"
          >
            {t("kyc.dateOfBirth") || "Date of Birth"} *
          </label>
          <input
            id="dateOfBirth"
            type="date"
            value={formData.dateOfBirth}
            onChange={(e) => handleInputChange("dateOfBirth", e.target.value)}
            className={`w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400 transition-all ${
              errors.dateOfBirth ? "border-red-500" : "border-pluto-200"
            }`}
            aria-describedby={errors.dateOfBirth ? "dateOfBirth-error" : undefined}
            aria-invalid={!!errors.dateOfBirth}
            required
          />
          <AnimatePresence>
            {errors.dateOfBirth && (
              <motion.p
                id="dateOfBirth-error"
                className="mt-1 text-sm text-red-600"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                role="alert"
              >
                {errors.dateOfBirth}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Address */}
        <motion.div variants={fieldVariants}>
          <label
            htmlFor="address"
            className="block text-sm font-medium text-pluto-900 mb-2"
          >
            {t("kyc.address") || "Residential Address"} *
          </label>
          <textarea
            id="address"
            value={formData.address}
            onChange={(e) => handleInputChange("address", e.target.value)}
            rows={3}
            className={`w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400 transition-all ${
              errors.address ? "border-red-500" : "border-pluto-200"
            }`}
            aria-describedby={errors.address ? "address-error" : undefined}
            aria-invalid={!!errors.address}
            required
          />
          <AnimatePresence>
            {errors.address && (
              <motion.p
                id="address-error"
                className="mt-1 text-sm text-red-600"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                role="alert"
              >
                {errors.address}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ID Type */}
        <motion.div variants={fieldVariants}>
          <label
            htmlFor="idType"
            className="block text-sm font-medium text-pluto-900 mb-2"
          >
            {t("kyc.idType") || "ID Type"} *
          </label>
          <select
            id="idType"
            value={formData.idType}
            onChange={(e) => handleInputChange("idType", e.target.value)}
            className={`w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400 transition-all ${
              errors.idType ? "border-red-500" : "border-pluto-200"
            }`}
            aria-describedby={errors.idType ? "idType-error" : undefined}
            aria-invalid={!!errors.idType}
            required
          >
            <option value="">{t("kyc.selectIdType") || "Select ID type"}</option>
            <option value="passport">{t("kyc.passport") || "Passport"}</option>
            <option value="drivers-license">{t("kyc.driversLicense") || "Driver's License"}</option>
            <option value="national-id">{t("kyc.nationalId") || "National ID"}</option>
          </select>
          <AnimatePresence>
            {errors.idType && (
              <motion.p
                id="idType-error"
                className="mt-1 text-sm text-red-600"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                role="alert"
              >
                {errors.idType}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ID Number */}
        <motion.div variants={fieldVariants}>
          <label
            htmlFor="idNumber"
            className="block text-sm font-medium text-pluto-900 mb-2"
          >
            {t("kyc.idNumber") || "ID Number"} *
          </label>
          <input
            id="idNumber"
            type="text"
            value={formData.idNumber}
            onChange={(e) => handleInputChange("idNumber", e.target.value)}
            className={`w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400 transition-all ${
              errors.idNumber ? "border-red-500" : "border-pluto-200"
            }`}
            aria-describedby={errors.idNumber ? "idNumber-error" : undefined}
            aria-invalid={!!errors.idNumber}
            required
          />
          <AnimatePresence>
            {errors.idNumber && (
              <motion.p
                id="idNumber-error"
                className="mt-1 text-sm text-red-600"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                role="alert"
              >
                {errors.idNumber}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Document Upload */}
        <motion.div variants={fieldVariants}>
          <label
            htmlFor="documentUpload"
            className="block text-sm font-medium text-pluto-900 mb-2"
          >
            {t("kyc.documentUpload") || "Upload ID Document"} *
          </label>
          <div className="relative">
            <input
              id="documentUpload"
              type="file"
              accept="image/*,.pdf"
              onChange={handleFileChange}
              className={`w-full rounded-xl border px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pluto-400 transition-all file:mr-4 file:rounded-lg file:border-0 file:bg-pluto-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-pluto-900 hover:file:bg-pluto-200 ${
                errors.documentUpload ? "border-red-500" : "border-pluto-200"
              }`}
              aria-describedby={errors.documentUpload ? "documentUpload-error" : "documentUpload-help"}
              aria-invalid={!!errors.documentUpload}
              required
            />
            <p id="documentUpload-help" className="mt-1 text-xs text-pluto-600">
              {t("kyc.documentHelp") || "Accepted formats: JPG, PNG, PDF. Max size: 5MB"}
            </p>
          </div>
          <AnimatePresence>
            {errors.documentUpload && (
              <motion.p
                id="documentUpload-error"
                className="mt-1 text-sm text-red-600"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                role="alert"
              >
                {errors.documentUpload}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Form actions */}
        <motion.div
          variants={fieldVariants}
          className="flex gap-4 pt-4"
        >
          <motion.button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-pluto-200 bg-white px-6 py-3 font-semibold text-pluto-900 transition-all hover:bg-pluto-50 focus:ring-2 focus:ring-pluto-400"
            variants={submitVariants}
            animate="idle"
            disabled={isPending}
          >
            {t("common.cancel") || "Cancel"}
          </motion.button>
          <motion.button
            type="submit"
            className="flex-1 rounded-xl bg-pluto-600 px-6 py-3 font-semibold text-white transition-all hover:bg-pluto-700 focus:ring-2 focus:ring-pluto-400 disabled:opacity-50 disabled:cursor-not-allowed"
            variants={submitVariants}
            animate={submitStatus}
            disabled={isPending}
            aria-describedby="submit-status"
          >
            {isPending ? (
              <span className="flex items-center justify-center gap-2">
                <motion.div
                  className="h-4 w-4 rounded-full border-2 border-white border-t-transparent"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                />
                {t("kyc.submitting") || "Submitting..."}
              </span>
            ) : submitStatus === "success" ? (
              t("kyc.submitted") || "Submitted!"
            ) : (
              t("kyc.submit") || "Submit KYC"
            )}
          </motion.button>
        </motion.div>

        {/* Submit status for screen readers */}
        <div id="submit-status" className="sr-only">
          {submitStatus === "loading" && (t("kyc.submitting") || "Submitting form...")}
          {submitStatus === "success" && (t("kyc.submitSuccess") || "Form submitted successfully")}
          {submitStatus === "error" && (t("kyc.submitError") || "Form submission failed")}
        </div>
      </motion.form>
    </div>
  );
};

export default KYCSubmissionForm;