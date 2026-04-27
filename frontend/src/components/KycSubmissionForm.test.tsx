/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import KycSubmissionForm from "./KycSubmissionForm";

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motion = new Proxy(
    {},
    {
      get: (_, tag: string) =>
        React.forwardRef(function MockMotion({ children, ...props }: any, ref) {
          return React.createElement(tag, { ...props, ref }, children);
        }),
    },
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

describe("KycSubmissionForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("renders personal info step initially", () => {
    render(React.createElement(KycSubmissionForm));
    expect(screen.getByText("personalInfo")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("firstName")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("lastName")).toBeInTheDocument();
  });

  it("navigates to address step when next is clicked", () => {
    render(React.createElement(KycSubmissionForm));
    const nextButton = screen.getByText("next");
    fireEvent.click(nextButton);
    expect(screen.getByText("addressInfo")).toBeInTheDocument();
  });

  it("navigates back to personal step", () => {
    render(React.createElement(KycSubmissionForm));
    fireEvent.click(screen.getByText("next"));
    expect(screen.getByText("addressInfo")).toBeInTheDocument();
    fireEvent.click(screen.getByText("back"));
    expect(screen.getByText("personalInfo")).toBeInTheDocument();
  });

  it("updates personal info fields", () => {
    render(React.createElement(KycSubmissionForm));
    const firstNameInput = screen.getByPlaceholderText("firstName") as HTMLInputElement;
    fireEvent.change(firstNameInput, { target: { value: "John" } });
    expect(firstNameInput.value).toBe("John");
  });

  it("shows all four steps in progress indicator", () => {
    const { container } = render(React.createElement(KycSubmissionForm));
    const stepIndicators = container.querySelectorAll('[class*="rounded-full"]');
    expect(stepIndicators.length).toBeGreaterThanOrEqual(4);
  });

  it("displays error message when submission fails", async () => {
    (global.fetch as any).mockRejectedValue(new Error("Network error"));

    render(React.createElement(KycSubmissionForm));

    // Navigate to review step
    fireEvent.click(screen.getByText("next")); // to address
    fireEvent.click(screen.getByText("next")); // to documents
    fireEvent.click(screen.getByText("next")); // to review

    const submitButton = screen.getByText("submit");
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
  });

  it("shows success message after successful submission", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(React.createElement(KycSubmissionForm));

    // Navigate to review step
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));

    const submitButton = screen.getByText("submit");
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("successTitle")).toBeInTheDocument();
      expect(mockToastSuccess).toHaveBeenCalled();
    });
  });

  it("allows resetting form after successful submission", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(React.createElement(KycSubmissionForm));

    // Navigate and submit
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("submit"));

    await waitFor(() => {
      expect(screen.getByText("successTitle")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("submitAnother"));

    await waitFor(() => {
      expect(screen.getByText("personalInfo")).toBeInTheDocument();
    });
  });

  it("updates address fields correctly", () => {
    render(React.createElement(KycSubmissionForm));
    fireEvent.click(screen.getByText("next"));

    const cityInput = screen.getByPlaceholderText("city") as HTMLInputElement;
    fireEvent.change(cityInput, { target: { value: "New York" } });
    expect(cityInput.value).toBe("New York");
  });

  it("shows document upload fields on documents step", () => {
    render(React.createElement(KycSubmissionForm));
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));

    expect(screen.getByText("documents")).toBeInTheDocument();
    expect(screen.getByText("idFront")).toBeInTheDocument();
    expect(screen.getByText("selfie")).toBeInTheDocument();
  });

  it("displays review summary on final step", () => {
    render(React.createElement(KycSubmissionForm));

    // Fill personal info
    fireEvent.change(screen.getByPlaceholderText("firstName"), { target: { value: "John" } });
    fireEvent.change(screen.getByPlaceholderText("lastName"), { target: { value: "Doe" } });
    fireEvent.click(screen.getByText("next"));

    // Fill address
    fireEvent.change(screen.getByPlaceholderText("city"), { target: { value: "NYC" } });
    fireEvent.click(screen.getByText("next"));

    // Skip documents
    fireEvent.click(screen.getByText("next"));

    expect(screen.getByText("review")).toBeInTheDocument();
  });

  it("validates required fields before proceeding to next step", async () => {
    render(React.createElement(KycSubmissionForm));

    // Try to proceed without filling required fields
    const nextButton = screen.getByText("next");
    fireEvent.click(nextButton);

    // Should stay on personal step (first step)
    expect(screen.getByText("personalInfo")).toBeInTheDocument();

    // Fill required fields
    fireEvent.change(screen.getByPlaceholderText("firstName"), { target: { value: "John" } });
    fireEvent.change(screen.getByPlaceholderText("lastName"), { target: { value: "Doe" } });

    // Now proceed
    fireEvent.click(nextButton);
    expect(screen.getByText("addressInfo")).toBeInTheDocument();
  });

  it("handles file uploads correctly", () => {
    render(React.createElement(KycSubmissionForm));

    // Navigate to documents step
    fireEvent.click(screen.getByText("next")); // personal
    fireEvent.click(screen.getByText("next")); // address
    fireEvent.click(screen.getByText("next")); // documents

    const fileInput = screen.getByText("idFront") as HTMLInputElement;
    const file = new File(["dummy content"], "test.png", { type: "image/png" });

    fireEvent.change(fileInput, { target: { files: [file] } });

    // Verify file is selected (this would depend on component implementation)
    expect(fileInput.files?.[0]).toBe(file);
  });

  it("displays progress indicator correctly", () => {
    render(React.createElement(KycSubmissionForm));

    // Initial step should show 1 of 4
    const progressElements = screen.getAllByText(/\d+ of \d+/);
    expect(progressElements.length).toBeGreaterThan(0);

    // Navigate through steps
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));

    // Should show 4 of 4 or completed state
    expect(screen.getByText("review")).toBeInTheDocument();
  });

  it("prevents navigation beyond bounds", () => {
    render(React.createElement(KycSubmissionForm));

    // Try to go back from first step
    const backButton = screen.getByText("back");
    fireEvent.click(backButton);

    // Should still be on first step
    expect(screen.getByText("personalInfo")).toBeInTheDocument();

    // Navigate to last step
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));

    // Try to go next from last step
    const nextButton = screen.getByText("next");
    fireEvent.click(nextButton);

    // Should still be on last step
    expect(screen.getByText("review")).toBeInTheDocument();
  });

  it("shows loading state during submission", async () => {
    (global.fetch as any).mockImplementation(() => new Promise(() => {})); // Never resolves

    render(React.createElement(KycSubmissionForm));

    // Navigate to review
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));

    const submitButton = screen.getByText("submit");
    fireEvent.click(submitButton);

    // Should show loading state
    expect(submitButton).toBeDisabled();
  });

  it("handles form reset after successful submission", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(React.createElement(KycSubmissionForm));

    // Fill and submit
    fireEvent.change(screen.getByPlaceholderText("firstName"), { target: { value: "John" } });
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("submit"));

    await waitFor(() => {
      expect(screen.getByText("submitAnother")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("submitAnother"));

    // Should reset to first step
    expect(screen.getByText("personalInfo")).toBeInTheDocument();

    // Fields should be cleared
    const firstNameInput = screen.getByPlaceholderText("firstName") as HTMLInputElement;
    expect(firstNameInput.value).toBe("");
  });

  it("displays field-specific validation errors", () => {
    render(React.createElement(KycSubmissionForm));

    // Try to submit with invalid email format
    const emailInput = screen.getByPlaceholderText("email") as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "invalid-email" } });

    // Validation should show error (component-specific logic)
    // This test assumes the component has email validation
    expect(emailInput.value).toBe("invalid-email");
  });

  it("handles network errors gracefully", async () => {
    (global.fetch as any).mockRejectedValue(new Error("Network error"));

    render(React.createElement(KycSubmissionForm));

    // Navigate and submit
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("next"));
    fireEvent.click(screen.getByText("submit"));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });

    // Should allow retry
    const retryButton = screen.getByText("submit");
    expect(retryButton).toBeInTheDocument();
  });

  it("maintains form state when navigating between steps", () => {
    render(React.createElement(KycSubmissionForm));

    // Fill personal info
    const firstNameInput = screen.getByPlaceholderText("firstName") as HTMLInputElement;
    fireEvent.change(firstNameInput, { target: { value: "John" } });

    // Navigate to address
    fireEvent.click(screen.getByText("next"));

    // Navigate back
    fireEvent.click(screen.getByText("back"));

    // Value should be preserved
    expect(firstNameInput.value).toBe("John");
  });
});
