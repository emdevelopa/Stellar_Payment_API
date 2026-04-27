"use client";

export interface CreatedPayment {
  payment_id: string;
  payment_link: string;
  status: string;
}

export type CreatePaymentStage = "editing" | "submitting" | "success";

export interface CreatePaymentFlowState {
  stage: CreatePaymentStage;
  created: CreatedPayment | null;
}

export type CreatePaymentFlowAction =
  | { type: "submit" }
  | { type: "success"; created: CreatedPayment }
  | { type: "reset" }
  | { type: "failure" };

export const initialCreatePaymentFlowState: CreatePaymentFlowState = {
  stage: "editing",
  created: null,
};

export function createPaymentFlowReducer(
  state: CreatePaymentFlowState,
  action: CreatePaymentFlowAction,
): CreatePaymentFlowState {
  switch (action.type) {
    case "submit":
      return {
        stage: "submitting",
        created: null,
      };
    case "success":
      return {
        stage: "success",
        created: action.created,
      };
    case "failure":
    case "reset":
      return initialCreatePaymentFlowState;
    default:
      return state;
  }
}
