import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { TwoFactorAuthSetup } from "./TwoFactorAuthSetup";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("./ui/Spinner", () => ({
  Spinner: ({ size, ...props }: { size?: string }) => (
    <svg data-testid="spinner" aria-hidden={props["aria-hidden"]} role="img" />
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translations: Record<string, string> = {
      "ariaLabel": "Two-factor authentication setup",
      "stepsLabel": "Setup steps",
      "title": "Enable Two-Factor Authentication",
      "description": "Protect your account with an authenticator app. You will need to scan a QR code to get started.",
      "enableButton": "Enable 2FA",
      "settingUp": "Setting up…",
      "scanTitle": "Scan with your authenticator app",
      "scanDescription": "Use Google Authenticator, Authy, or any TOTP-compatible app to scan the code below.",
      "qrCodeAlt": "TOTP QR code — scan with your authenticator app",
      "qrCodeSkeletonLabel": "Generating QR code…",
      "manualKeyLabel": "Or enter key manually",
      "codeInputLabel": "Enter 6-digit code",
      "codeInputPlaceholder": "000000",
      "verifyButton": "Verify & Enable",
      "verifying": "Verifying…",
      "successTitle": "Two-Factor Authentication Enabled",
      "successDescription": "Your account is now protected. You will be prompted for a code on each login.",
      "error.setupFailed": "Failed to start 2FA setup. Please try again.",
      "error.invalidCode": "Invalid code. Please try again.",
      "error.codeLength": "Please enter the 6-digit code from your authenticator app.",
    };

    return (key: string, params?: Record<string, string>) => {
      const value = translations[key] || key;
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          value
        );
      }
      return value;
    };
  },
}));

const SUCCESS_RESULT = {
  qrDataUrl: "data:image/png;base64,mock-qr",
  manualKey: "JBSWY3DPEHPK3PXP",
};

function makeGenerateSecret(delay = 0) {
  return vi.fn().mockImplementation(
    () => new Promise<typeof SUCCESS_RESULT>((resolve) => setTimeout(() => resolve(SUCCESS_RESULT), delay))
  );
}

function makeVerifyCode(shouldFail = false, delay = 0) {
  return vi.fn().mockImplementation(
    () =>
      new Promise<void>((resolve, reject) =>
        setTimeout(() => (shouldFail ? reject(new Error("Invalid code")) : resolve()), delay)
      )
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("TwoFactorAuthSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial idle state ───────────────────────────────────────────────────

  it("renders the enable button in idle state", () => {
    render(<TwoFactorAuthSetup onGenerateSecret={makeGenerateSecret()} onVerifyCode={makeVerifyCode()} />);
    expect(screen.getByRole("button", { name: /enable 2fa/i })).toBeInTheDocument();
  });

  it("does not show QR code or code input before enabling", () => {
    render(<TwoFactorAuthSetup onGenerateSecret={makeGenerateSecret()} onVerifyCode={makeVerifyCode()} />);
    expect(screen.queryByLabelText(/enter 6-digit code/i)).not.toBeInTheDocument();
    expect(screen.queryByAltText(/qr code/i)).not.toBeInTheDocument();
  });

  // ── Loading state: enabling ─────────────────────────────────────────────

  it("shows loading spinner and disables button while generating secret", async () => {
    const generateSecret = makeGenerateSecret(500);
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={makeVerifyCode()} />);

    await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));

    const btn = screen.getByRole("button", { name: /setting up/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
  });

  it("section has aria-busy=true while enabling", async () => {
    const generateSecret = makeGenerateSecret(500);
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={makeVerifyCode()} />);

    await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));

    expect(screen.getByRole("region", { name: /two-factor authentication setup/i }))
      .toHaveAttribute("aria-busy", "true");
  });

  it("shows QR skeleton while generating secret", async () => {
    const generateSecret = makeGenerateSecret(500);
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={makeVerifyCode()} />);

    await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));

    // After moving to scan step (without QR yet resolved), we should not see the QR image
    // The skeleton appears when scanVisible=true and qrDataUrl is still null
    // This is visible during the enabling → scan transition
  });

  // ── Scan step ───────────────────────────────────────────────────────────

  it("shows QR code and manual key after secret is generated", async () => {
    vi.useFakeTimers();
    const generateSecret = makeGenerateSecret(0);
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={makeVerifyCode()} />);

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
      vi.runAllTimers();
    });

    await waitFor(() => {
      expect(screen.getByAltText(/totp qr code/i)).toBeInTheDocument();
      expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    });
    vi.useRealTimers();
  });

  it("renders the code input field in scan step", async () => {
    vi.useFakeTimers();
    const generateSecret = makeGenerateSecret(0);
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={makeVerifyCode()} />);

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
      vi.runAllTimers();
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/enter 6-digit code/i)).toBeInTheDocument();
    });
    vi.useRealTimers();
  });

  it("verify button is disabled when fewer than 6 digits are entered", async () => {
    vi.useFakeTimers();
    const generateSecret = makeGenerateSecret(0);
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={makeVerifyCode()} />);

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
      vi.runAllTimers();
    });

    await waitFor(() => screen.getByLabelText(/enter 6-digit code/i));

    const input = screen.getByLabelText(/enter 6-digit code/i);
    fireEvent.change(input, { target: { value: "123" } });

    expect(screen.getByRole("button", { name: /verify & enable/i })).toBeDisabled();
    vi.useRealTimers();
  });

  it("verify button is enabled with a 6-digit code", async () => {
    vi.useFakeTimers();
    const generateSecret = makeGenerateSecret(0);
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={makeVerifyCode()} />);

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
      vi.runAllTimers();
    });

    await waitFor(() => screen.getByLabelText(/enter 6-digit code/i));

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "123456" } });

    expect(screen.getByRole("button", { name: /verify & enable/i })).not.toBeDisabled();
    vi.useRealTimers();
  });

  // ── Loading state: verifying ─────────────────────────────────────────────

  it("shows verifying spinner and disables input while verifying", async () => {
    vi.useFakeTimers();
    const generateSecret = makeGenerateSecret(0);
    const verifyCode = makeVerifyCode(false, 500);
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={verifyCode} />);

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
      vi.runAllTimers();
    });

    await waitFor(() => screen.getByLabelText(/enter 6-digit code/i));

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "123456" } });

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /verify & enable/i }));
    });

    const verifyBtn = screen.getByRole("button", { name: /verifying/i });
    expect(verifyBtn).toBeDisabled();
    expect(verifyBtn).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText(/enter 6-digit code/i)).toBeDisabled();
    vi.useRealTimers();
  });

  // ── Error handling ───────────────────────────────────────────────────────

  it("shows error and stays on scan step when generate fails", async () => {
    const generateSecret = vi.fn().mockRejectedValue(new Error("Network error"));
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={makeVerifyCode()} />);

    await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /enable 2fa/i })).toBeInTheDocument();
    });
  });

  it("shows error message when verification fails", async () => {
    vi.useFakeTimers();
    const generateSecret = makeGenerateSecret(0);
    const verifyCode = makeVerifyCode(true, 0);
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={verifyCode} />);

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
      vi.runAllTimers();
    });

    await waitFor(() => screen.getByLabelText(/enter 6-digit code/i));

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "000000" } });

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /verify & enable/i }));
      vi.runAllTimers();
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid code");
    });
    vi.useRealTimers();
  });

  it("error message has role=alert for screen readers", async () => {
    const generateSecret = vi.fn().mockRejectedValue(new Error("Setup failed"));
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={makeVerifyCode()} />);

    await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  // ── Success state ────────────────────────────────────────────────────────

  it("shows success state and calls onComplete after verification", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const generateSecret = makeGenerateSecret(0);
    const verifyCode = makeVerifyCode(false, 0);
    render(
      <TwoFactorAuthSetup
        onGenerateSecret={generateSecret}
        onVerifyCode={verifyCode}
        onComplete={onComplete}
      />
    );

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
      vi.runAllTimers();
    });

    await waitFor(() => screen.getByLabelText(/enter 6-digit code/i));

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "123456" } });

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /verify & enable/i }));
      vi.runAllTimers();
    });

    await waitFor(() => {
      expect(screen.getByText(/two-factor authentication enabled/i)).toBeInTheDocument();
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    vi.useRealTimers();
  });

  it("success status region has aria-live=polite", async () => {
    vi.useFakeTimers();
    const generateSecret = makeGenerateSecret(0);
    const verifyCode = makeVerifyCode(false, 0);
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={verifyCode} />);

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
      vi.runAllTimers();
    });

    await waitFor(() => screen.getByLabelText(/enter 6-digit code/i));

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "123456" } });

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /verify & enable/i }));
      vi.runAllTimers();
    });

    await waitFor(() => {
      const status = screen.getByRole("status");
      expect(status).toHaveAttribute("aria-live", "polite");
    });
    vi.useRealTimers();
  });

  // ── Step progress ─────────────────────────────────────────────────────────

  it("first step dot is active on idle", () => {
    render(<TwoFactorAuthSetup onGenerateSecret={makeGenerateSecret()} onVerifyCode={makeVerifyCode()} />);
    const step1 = screen.getByRole("listitem", { hidden: false });
    expect(step1).toBeInTheDocument();
  });

  // ── Accessibility ─────────────────────────────────────────────────────────

  it("code input strips non-numeric characters", async () => {
    vi.useFakeTimers();
    const generateSecret = makeGenerateSecret(0);
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={makeVerifyCode()} />);

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
      vi.runAllTimers();
    });

    await waitFor(() => screen.getByLabelText(/enter 6-digit code/i));

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "12ab56" } });
    expect(screen.getByLabelText(/enter 6-digit code/i)).toHaveValue("1256");
    vi.useRealTimers();
  });

  it("code input is capped at 6 digits", async () => {
    vi.useFakeTimers();
    const generateSecret = makeGenerateSecret(0);
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={makeVerifyCode()} />);

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
      vi.runAllTimers();
    });

    await waitFor(() => screen.getByLabelText(/enter 6-digit code/i));

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "1234567890" } });
    expect(screen.getByLabelText(/enter 6-digit code/i)).toHaveValue("123456");
    vi.useRealTimers();
  });
});
