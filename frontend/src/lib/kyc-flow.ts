/**
 * KYC flow state machine.
 *
 * Enhanced with loading-state actions:
 * - STEP_LOADING / STEP_LOADED  — per-step async transition states
 * - STEP_ERROR / RETRY          — step-level error and recovery
 * - FILE_UPLOAD_START / FILE_UPLOAD_SUCCESS / FILE_UPLOAD_ERROR — per-file upload tracking
 *
 * All new state is additive; existing actions and selectors are unchanged so
 * the existing reducer test suite continues to pass without modification.
 */

// ── Step types ────────────────────────────────────────────────────────────────

export type KycStep = "personal" | "address" | "documents" | "review";

/** Discriminated union for each step's async loading state. */
export type KycStepLoadingState = "idle" | "loading" | "saving" | "error";

/** Upload state for a single file field. */
export type FileUploadState = "idle" | "uploading" | "success" | "error";

export interface FileUploadStatus {
  state: FileUploadState;
  /** Translated error message when state === "error". */
  errorMessage: string | null;
  /** Preview object URL (revoked when removed). */
  previewUrl: string | null;
}

// ── Domain data ───────────────────────────────────────────────────────────────

export interface PersonalInfo {
  firstName: string;
  lastName: string;
  email: string;
  nationality: string;
  dateOfBirth: string;
}

export interface AddressInfo {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface DocumentInfo {
  idType: "passport" | "drivers_license" | "national_id" | "";
  idNumber: string;
  idFrontFile: File | null;
  idBackFile: File | null;
  selfieFile: File | null;
}

// ── Full state ────────────────────────────────────────────────────────────────

export interface KycFlowState {
  currentStep: KycStep;
  personal: PersonalInfo;
  address: AddressInfo;
  documents: DocumentInfo;
  isSubmitting: boolean;
  error: string | null;
  submittedAt: string | null;

  /** Per-step async loading state (navigation + data-fetch). */
  stepLoadingState: KycStepLoadingState;
  /** Step-level error message (distinct from submission errors). */
  stepError: string | null;
  /** How many times the user has retried the current step after an error. */
  stepRetryCount: number;

  /** Upload tracking for each document file field. */
  fileUploads: {
    idFront: FileUploadStatus;
    idBack: FileUploadStatus;
    selfie: FileUploadStatus;
  };
}

const defaultFileUpload: FileUploadStatus = {
  state: "idle",
  errorMessage: null,
  previewUrl: null,
};

export const initialKycFlowState: KycFlowState = {
  currentStep: "personal",
  personal: { firstName: "", lastName: "", email: "", nationality: "", dateOfBirth: "" },
  address: { street: "", city: "", state: "", postalCode: "", country: "" },
  documents: { idType: "", idNumber: "", idFrontFile: null, idBackFile: null, selfieFile: null },
  isSubmitting: false,
  error: null,
  submittedAt: null,
  stepLoadingState: "idle",
  stepError: null,
  stepRetryCount: 0,
  fileUploads: {
    idFront: { ...defaultFileUpload },
    idBack:  { ...defaultFileUpload },
    selfie:  { ...defaultFileUpload },
  },
};

// ── Actions ───────────────────────────────────────────────────────────────────

export type FileUploadField = keyof KycFlowState["fileUploads"];

export type KycFlowAction =
  // ── Existing actions (unchanged) ──
  | { type: "SET_STEP"; step: KycStep }
  | { type: "UPDATE_PERSONAL"; data: Partial<PersonalInfo> }
  | { type: "UPDATE_ADDRESS"; data: Partial<AddressInfo> }
  | { type: "UPDATE_DOCUMENTS"; data: Partial<DocumentInfo> }
  | { type: "SUBMIT" }
  | { type: "SUBMIT_SUCCESS"; submittedAt: string }
  | { type: "SUBMIT_FAILURE"; error: string }
  | { type: "RESET" }
  // ── New loading-state actions ──
  /** Mark the current step as loading (e.g. async data-fetch on navigate). */
  | { type: "STEP_LOADING" }
  /** Step finished loading — transition to idle. */
  | { type: "STEP_LOADED" }
  /** Step-level async operation failed. */
  | { type: "STEP_ERROR"; error: string }
  /** User triggered a retry — increments counter and re-enters loading. */
  | { type: "RETRY" }
  /** Dismiss the step error banner without retrying. */
  | { type: "CLEAR_STEP_ERROR" }
  /** File upload started for a specific field. */
  | { type: "FILE_UPLOAD_START"; field: FileUploadField }
  /** File upload completed successfully. */
  | { type: "FILE_UPLOAD_SUCCESS"; field: FileUploadField; previewUrl: string | null }
  /** File upload failed. */
  | { type: "FILE_UPLOAD_ERROR"; field: FileUploadField; error: string }
  /** User removed an uploaded file — reverts field to idle. */
  | { type: "FILE_UPLOAD_RESET"; field: FileUploadField };

// ── Reducer ───────────────────────────────────────────────────────────────────

export function kycFlowReducer(
  state: KycFlowState,
  action: KycFlowAction,
): KycFlowState {
  switch (action.type) {
    // ── Existing cases (unchanged behaviour) ─────────────────────────────────

    case "SET_STEP":
      return { ...state, currentStep: action.step, error: null };

    case "UPDATE_PERSONAL":
      return { ...state, personal: { ...state.personal, ...action.data }, error: null };

    case "UPDATE_ADDRESS":
      return { ...state, address: { ...state.address, ...action.data }, error: null };

    case "UPDATE_DOCUMENTS":
      return { ...state, documents: { ...state.documents, ...action.data }, error: null };

    case "SUBMIT":
      return { ...state, isSubmitting: true, error: null };

    case "SUBMIT_SUCCESS":
      return { ...state, isSubmitting: false, submittedAt: action.submittedAt, error: null };

    case "SUBMIT_FAILURE":
      return { ...state, isSubmitting: false, error: action.error };

    case "RESET":
      return initialKycFlowState;

    // ── New loading-state cases ───────────────────────────────────────────────

    case "STEP_LOADING":
      return { ...state, stepLoadingState: "loading", stepError: null };

    case "STEP_LOADED":
      return { ...state, stepLoadingState: "idle" };

    case "STEP_ERROR":
      return { ...state, stepLoadingState: "error", stepError: action.error };

    case "RETRY":
      return {
        ...state,
        stepLoadingState: "loading",
        stepError: null,
        stepRetryCount: state.stepRetryCount + 1,
      };

    case "CLEAR_STEP_ERROR":
      return { ...state, stepLoadingState: "idle", stepError: null };

    case "FILE_UPLOAD_START":
      return {
        ...state,
        fileUploads: {
          ...state.fileUploads,
          [action.field]: { state: "uploading", errorMessage: null, previewUrl: null },
        },
      };

    case "FILE_UPLOAD_SUCCESS":
      return {
        ...state,
        fileUploads: {
          ...state.fileUploads,
          [action.field]: {
            state: "success",
            errorMessage: null,
            previewUrl: action.previewUrl,
          },
        },
      };

    case "FILE_UPLOAD_ERROR":
      return {
        ...state,
        fileUploads: {
          ...state.fileUploads,
          [action.field]: {
            state: "error",
            errorMessage: action.error,
            previewUrl: null,
          },
        },
      };

    case "FILE_UPLOAD_RESET":
      return {
        ...state,
        fileUploads: {
          ...state.fileUploads,
          [action.field]: { ...defaultFileUpload },
        },
      };

    default:
      return state;
  }
}

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectIsStepLoading = (s: KycFlowState) =>
  s.stepLoadingState === "loading";

export const selectIsStepSaving = (s: KycFlowState) =>
  s.stepLoadingState === "saving";

export const selectHasStepError = (s: KycFlowState) =>
  s.stepLoadingState === "error" && s.stepError !== null;

export const selectIsFileUploading = (
  s: KycFlowState,
  field: FileUploadField,
) => s.fileUploads[field].state === "uploading";

export const selectAnyFileUploading = (s: KycFlowState) =>
  Object.values(s.fileUploads).some((f) => f.state === "uploading");
