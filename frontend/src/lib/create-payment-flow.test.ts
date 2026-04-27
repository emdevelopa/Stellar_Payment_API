import { describe, expect, it } from "vitest";
import {
  createPaymentFlowReducer,
  initialCreatePaymentFlowState,
  type CreatedPayment,
} from "./create-payment-flow";

const createdPayment: CreatedPayment = {
  payment_id: "pay_123",
  payment_link: "https://example.com/pay/pay_123",
  status: "pending",
};

describe("createPaymentFlowReducer", () => {
  it("moves into a submitting state when a request starts", () => {
    expect(
      createPaymentFlowReducer(initialCreatePaymentFlowState, {
        type: "submit",
      }),
    ).toEqual({
      stage: "submitting",
      created: null,
    });
  });

  it("stores the created payment only after a successful response", () => {
    const submittingState = createPaymentFlowReducer(
      initialCreatePaymentFlowState,
      { type: "submit" },
    );

    expect(
      createPaymentFlowReducer(submittingState, {
        type: "success",
        created: createdPayment,
      }),
    ).toEqual({
      stage: "success",
      created: createdPayment,
    });
  });

  it("returns to a clean editing state after a failure", () => {
    const submittingState = createPaymentFlowReducer(
      initialCreatePaymentFlowState,
      { type: "submit" },
    );

    expect(
      createPaymentFlowReducer(submittingState, {
        type: "failure",
      }),
    ).toEqual(initialCreatePaymentFlowState);
  });

  it("fully resets a completed success state", () => {
    const successState = createPaymentFlowReducer(
      initialCreatePaymentFlowState,
      {
        type: "success",
        created: createdPayment,
      },
    );

    expect(
      createPaymentFlowReducer(successState, {
        type: "reset",
      }),
    ).toEqual(initialCreatePaymentFlowState);
  });
});
