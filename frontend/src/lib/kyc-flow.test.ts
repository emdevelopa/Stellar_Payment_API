import { describe, it, expect } from "vitest";
import {
  kycFlowReducer,
  initialKycFlowState,
  type KycFlowState,
} from "./kyc-flow";

describe("kycFlowReducer", () => {
  it("should return initial state", () => {
    expect(initialKycFlowState.currentStep).toBe("personal");
    expect(initialKycFlowState.isSubmitting).toBe(false);
    expect(initialKycFlowState.error).toBeNull();
  });

  it("should handle SET_STEP", () => {
    const state = kycFlowReducer(initialKycFlowState, {
      type: "SET_STEP",
      step: "address",
    });
    expect(state.currentStep).toBe("address");
    expect(state.error).toBeNull();
  });

  it("should handle UPDATE_PERSONAL", () => {
    const state = kycFlowReducer(initialKycFlowState, {
      type: "UPDATE_PERSONAL",
      data: { firstName: "John", lastName: "Doe" },
    });
    expect(state.personal.firstName).toBe("John");
    expect(state.personal.lastName).toBe("Doe");
  });

  it("should handle UPDATE_ADDRESS", () => {
    const state = kycFlowReducer(initialKycFlowState, {
      type: "UPDATE_ADDRESS",
      data: { city: "New York", country: "USA" },
    });
    expect(state.address.city).toBe("New York");
    expect(state.address.country).toBe("USA");
  });

  it("should handle UPDATE_DOCUMENTS", () => {
    const state = kycFlowReducer(initialKycFlowState, {
      type: "UPDATE_DOCUMENTS",
      data: { idType: "passport", idNumber: "AB123456" },
    });
    expect(state.documents.idType).toBe("passport");
    expect(state.documents.idNumber).toBe("AB123456");
  });

  it("should handle SUBMIT", () => {
    const state = kycFlowReducer(initialKycFlowState, { type: "SUBMIT" });
    expect(state.isSubmitting).toBe(true);
    expect(state.error).toBeNull();
  });

  it("should handle SUBMIT_SUCCESS", () => {
    const submittingState: KycFlowState = {
      ...initialKycFlowState,
      isSubmitting: true,
    };
    const timestamp = new Date().toISOString();
    const state = kycFlowReducer(submittingState, {
      type: "SUBMIT_SUCCESS",
      submittedAt: timestamp,
    });
    expect(state.isSubmitting).toBe(false);
    expect(state.submittedAt).toBe(timestamp);
    expect(state.error).toBeNull();
  });

  it("should handle SUBMIT_FAILURE", () => {
    const submittingState: KycFlowState = {
      ...initialKycFlowState,
      isSubmitting: true,
    };
    const state = kycFlowReducer(submittingState, {
      type: "SUBMIT_FAILURE",
      error: "Network error",
    });
    expect(state.isSubmitting).toBe(false);
    expect(state.error).toBe("Network error");
  });

  it("should handle RESET", () => {
    const modifiedState: KycFlowState = {
      ...initialKycFlowState,
      currentStep: "review",
      personal: { firstName: "John", lastName: "Doe", dateOfBirth: "1990-01-01", nationality: "US" },
      error: "Some error",
    };
    const state = kycFlowReducer(modifiedState, { type: "RESET" });
    expect(state).toEqual(initialKycFlowState);
  });

  it("should preserve other state when updating personal info", () => {
    const stateWithAddress: KycFlowState = {
      ...initialKycFlowState,
      address: { street: "123 Main St", city: "NYC", state: "NY", postalCode: "10001", country: "USA" },
    };
    const state = kycFlowReducer(stateWithAddress, {
      type: "UPDATE_PERSONAL",
      data: { firstName: "Jane" },
    });
    expect(state.personal.firstName).toBe("Jane");
    expect(state.address.street).toBe("123 Main St");
  });

  it("should clear error when updating any field", () => {
    const stateWithError: KycFlowState = {
      ...initialKycFlowState,
      error: "Previous error",
    };
    const state = kycFlowReducer(stateWithError, {
      type: "UPDATE_PERSONAL",
      data: { firstName: "John" },
    });
    expect(state.error).toBeNull();
  });
});
