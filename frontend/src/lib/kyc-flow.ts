export type KycStep = "personal" | "address" | "documents" | "review";

export interface PersonalInfo {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
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

export interface KycFlowState {
  currentStep: KycStep;
  personal: PersonalInfo;
  address: AddressInfo;
  documents: DocumentInfo;
  isSubmitting: boolean;
  error: string | null;
  submittedAt: string | null;
}

export const initialKycFlowState: KycFlowState = {
  currentStep: "personal",
  personal: {
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    nationality: "",
  },
  address: {
    street: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
  },
  documents: {
    idType: "",
    idNumber: "",
    idFrontFile: null,
    idBackFile: null,
    selfieFile: null,
  },
  isSubmitting: false,
  error: null,
  submittedAt: null,
};

export type KycFlowAction =
  | { type: "SET_STEP"; step: KycStep }
  | { type: "UPDATE_PERSONAL"; data: Partial<PersonalInfo> }
  | { type: "UPDATE_ADDRESS"; data: Partial<AddressInfo> }
  | { type: "UPDATE_DOCUMENTS"; data: Partial<DocumentInfo> }
  | { type: "SUBMIT" }
  | { type: "SUBMIT_SUCCESS"; submittedAt: string }
  | { type: "SUBMIT_FAILURE"; error: string }
  | { type: "RESET" };

export function kycFlowReducer(
  state: KycFlowState,
  action: KycFlowAction,
): KycFlowState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, currentStep: action.step, error: null };

    case "UPDATE_PERSONAL":
      return {
        ...state,
        personal: { ...state.personal, ...action.data },
        error: null,
      };

    case "UPDATE_ADDRESS":
      return {
        ...state,
        address: { ...state.address, ...action.data },
        error: null,
      };

    case "UPDATE_DOCUMENTS":
      return {
        ...state,
        documents: { ...state.documents, ...action.data },
        error: null,
      };

    case "SUBMIT":
      return { ...state, isSubmitting: true, error: null };

    case "SUBMIT_SUCCESS":
      return {
        ...state,
        isSubmitting: false,
        submittedAt: action.submittedAt,
        error: null,
      };

    case "SUBMIT_FAILURE":
      return {
        ...state,
        isSubmitting: false,
        error: action.error,
      };

    case "RESET":
      return initialKycFlowState;

    default:
      return state;
  }
}
