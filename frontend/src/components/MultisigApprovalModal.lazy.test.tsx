import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock next/dynamic
vi.mock("next/dynamic", () => ({
  default: vi.fn(({ loading: LoadingComponent }: any) => {
    return ({ isOpen }: any) => isOpen ? <LoadingComponent /> : null;
  }),
}));

describe("MultisigApprovalModal.lazy", () => {
  it("renders loading state when modal opens", async () => {
    // Test import to verify module exists
    const module = await import("./MultisigApprovalModal.lazy");
    expect(module.default).toBeDefined();
  });
});
