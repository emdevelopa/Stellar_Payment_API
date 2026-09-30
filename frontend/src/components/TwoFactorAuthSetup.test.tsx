import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
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
      "retryButton": "Retry",
      "stepAnnouncement": "Step {current} of {total}",
      "successTitle": "Two-Factor Authentication Enabled",
      "successDescription": "Your account is now protected. You will be prompted for a code on each login.",
      "error.setupFailed": "Failed to start 2FA setup. Please try again.",
      "error.invalidCode": "Invalid code. Please try again.",
      "error.codeLength": "Please enter the 6-digit code from your authenticator app.",
      "error.networkFailure": "Couldn't reach the server. Check your connection and retry — your code and QR setup are still here.",
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

/**
 * Drives the component from idle to the scan step using fake timers.
 *
 * IMPORTANT: `waitFor` must never be awaited while fake timers are active —
 * it polls via `setTimeout`, which is frozen once `vi.useFakeTimers()` runs,
 * so it hangs until Vitest's own test timeout. Every state transition here
 * is instead flushed synchronously via `act(() => vi.runAllTimers())`, then
 * asserted on directly (matching the working pattern already used elsewhere
 * in this repo, e.g. KycSubmissionForm.test.tsx).
 */
async function renderAndEnable(
  generateSecret: ReturnType<typeof makeGenerateSecret>,
  verifyCode: ReturnType<typeof makeVerifyCode>,
  onComplete?: () => void
) {
  render(
    <TwoFactorAuthSetup
      onGenerateSecret={generateSecret}
      onVerifyCode={verifyCode}
      onComplete={onComplete}
    />
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
    vi.runAllTimers();
  });
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

  it("shows loading spinner and disables button while generating secret", () => {
    const generateSecret = makeGenerateSecret(500);
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={makeVerifyCode()} />);

    fireEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));

    const btn = screen.getByRole("button", { name: /setting up/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
  });

  it("section has aria-busy=true while enabling", () => {
    const generateSecret = makeGenerateSecret(500);
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={makeVerifyCode()} />);

    fireEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));

    expect(screen.getByRole("region", { name: /two-factor authentication setup/i }))
      .toHaveAttribute("aria-busy", "true");
  });

  it("shows the QR skeleton only until the QR image is available, never alongside it", async () => {
    vi.useFakeTimers();
    // setQrDataUrl and setStep("scan") land in the same state-update batch
    // (handleEnable's .then()), so the skeleton and the real QR image are
    // never both/neither present from an external observer's perspective —
    // this asserts that invariant holds once the scan step is reached.
    await renderAndEnable(makeGenerateSecret(0), makeVerifyCode());

    expect(screen.queryByLabelText(/generating qr code/i)).not.toBeInTheDocument();
    expect(screen.getByAltText(/totp qr code/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  // ── Scan step ───────────────────────────────────────────────────────────

  it("shows QR code and manual key after secret is generated", async () => {
    vi.useFakeTimers();
    await renderAndEnable(makeGenerateSecret(0), makeVerifyCode());

    expect(screen.getByAltText(/totp qr code/i)).toBeInTheDocument();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("renders the code input field in scan step", async () => {
    vi.useFakeTimers();
    await renderAndEnable(makeGenerateSecret(0), makeVerifyCode());

    expect(screen.getByLabelText(/enter 6-digit code/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("verify button is disabled when fewer than 6 digits are entered", async () => {
    vi.useFakeTimers();
    await renderAndEnable(makeGenerateSecret(0), makeVerifyCode());

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "123" } });

    expect(screen.getByRole("button", { name: /verify & enable/i })).toBeDisabled();
    vi.useRealTimers();
  });

  it("verify button is enabled with a 6-digit code", async () => {
    vi.useFakeTimers();
    await renderAndEnable(makeGenerateSecret(0), makeVerifyCode());

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "123456" } });

    expect(screen.getByRole("button", { name: /verify & enable/i })).not.toBeDisabled();
    vi.useRealTimers();
  });

  // ── Loading state: verifying ─────────────────────────────────────────────

  it("shows verifying spinner and disables input while verifying", async () => {
    vi.useFakeTimers();
    await renderAndEnable(makeGenerateSecret(0), makeVerifyCode(false, 500));

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "123456" } });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /verify & enable/i }));
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

    fireEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /enable 2fa/i })).toBeInTheDocument();
    });
  });

  it("shows error message when verification fails", async () => {
    vi.useFakeTimers();
    await renderAndEnable(makeGenerateSecret(0), makeVerifyCode(true, 0));

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "000000" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /verify & enable/i }));
      vi.runAllTimers();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Invalid code");
    vi.useRealTimers();
  });

  it("error message has role=alert for screen readers", async () => {
    const generateSecret = vi.fn().mockRejectedValue(new Error("Setup failed"));
    render(<TwoFactorAuthSetup onGenerateSecret={generateSecret} onVerifyCode={makeVerifyCode()} />);

    fireEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  // ── Success state ────────────────────────────────────────────────────────

  it("shows success state and calls onComplete after verification", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    await renderAndEnable(makeGenerateSecret(0), makeVerifyCode(false, 0), onComplete);

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "123456" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /verify & enable/i }));
      vi.runAllTimers();
    });

    expect(screen.getByText(/two-factor authentication enabled/i)).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("success status region has aria-live=polite", async () => {
    vi.useFakeTimers();
    await renderAndEnable(makeGenerateSecret(0), makeVerifyCode(false, 0));

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "123456" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /verify & enable/i }));
      vi.runAllTimers();
    });

    const status = screen.getAllByRole("status").find((el) => el.textContent?.match(/enabled/i));
    expect(status).toHaveAttribute("aria-live", "polite");
    vi.useRealTimers();
  });

  // ── Step progress ─────────────────────────────────────────────────────────

  it("first step dot is active on idle", () => {
    render(<TwoFactorAuthSetup onGenerateSecret={makeGenerateSecret()} onVerifyCode={makeVerifyCode()} />);
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    const firstDot = steps[0].querySelector('[aria-current="step"]');
    expect(firstDot).toBeInTheDocument();
  });

  // ── Accessibility ─────────────────────────────────────────────────────────

  it("code input strips non-numeric characters", async () => {
    vi.useFakeTimers();
    await renderAndEnable(makeGenerateSecret(0), makeVerifyCode());

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "12ab56" } });
    expect(screen.getByLabelText(/enter 6-digit code/i)).toHaveValue("1256");
    vi.useRealTimers();
  });

  it("code input is capped at 6 digits", async () => {
    vi.useFakeTimers();
    await renderAndEnable(makeGenerateSecret(0), makeVerifyCode());

    fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "1234567890" } });
    expect(screen.getByLabelText(/enter 6-digit code/i)).toHaveValue("123456");
    vi.useRealTimers();
  });

  // ── Optimistic rollback on network failure (#1519) ─────────────────────────

  describe("network failure rollback", () => {
    it("preserves the entered code and QR state when verification fails with a network error", async () => {
      vi.useFakeTimers();
      const verifyCode = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      await renderAndEnable(makeGenerateSecret(0), verifyCode);

      fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "123456" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /verify & enable/i }));
        vi.runAllTimers();
      });

      // Code is preserved — the user shouldn't have to retype it after a network blip.
      expect(screen.getByLabelText(/enter 6-digit code/i)).toHaveValue("123456");
      // QR/manual key stay visible — no needless re-scan.
      expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
      vi.useRealTimers();
    });

    it("shows a retry action after a network failure", async () => {
      vi.useFakeTimers();
      const verifyCode = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      await renderAndEnable(makeGenerateSecret(0), verifyCode);

      fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "123456" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /verify & enable/i }));
        vi.runAllTimers();
      });

      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
      vi.useRealTimers();
    });

    it("clears the code (no rollback) when verification fails with an invalid-code error, not a network error", async () => {
      vi.useFakeTimers();
      const verifyCode = vi.fn().mockRejectedValue(new Error("Invalid code"));
      await renderAndEnable(makeGenerateSecret(0), verifyCode);

      fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "000000" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /verify & enable/i }));
        vi.runAllTimers();
      });

      expect(screen.getByLabelText(/enter 6-digit code/i)).toHaveValue("");
      expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
      vi.useRealTimers();
    });

    it("retry button re-attempts verification with the preserved code", async () => {
      vi.useFakeTimers();
      const verifyCode = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(undefined);
      await renderAndEnable(makeGenerateSecret(0), verifyCode);

      fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "123456" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /verify & enable/i }));
        vi.runAllTimers();
      });
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /retry/i }));
        vi.runAllTimers();
      });

      expect(verifyCode).toHaveBeenCalledTimes(2);
      expect(verifyCode).toHaveBeenNthCalledWith(2, "123456");
      expect(screen.getByText(/two-factor authentication enabled/i)).toBeInTheDocument();
      vi.useRealTimers();
    });
  });

  // ── Keyboard navigation (#1520) ─────────────────────────────────────────────

  describe("keyboard navigation", () => {
    it("submits verification when Enter is pressed with a complete code", async () => {
      vi.useFakeTimers();
      const verifyCode = makeVerifyCode(false, 0);
      await renderAndEnable(makeGenerateSecret(0), verifyCode);

      const input = screen.getByLabelText(/enter 6-digit code/i);
      fireEvent.change(input, { target: { value: "123456" } });

      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
        vi.runAllTimers();
      });

      expect(verifyCode).toHaveBeenCalledWith("123456");
      vi.useRealTimers();
    });

    it("does not submit on Enter when the code is incomplete", async () => {
      vi.useFakeTimers();
      const verifyCode = makeVerifyCode(false, 0);
      await renderAndEnable(makeGenerateSecret(0), verifyCode);

      const input = screen.getByLabelText(/enter 6-digit code/i);
      fireEvent.change(input, { target: { value: "123" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(verifyCode).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("clears the code when Escape is pressed", async () => {
      vi.useFakeTimers();
      await renderAndEnable(makeGenerateSecret(0), makeVerifyCode());

      const input = screen.getByLabelText(/enter 6-digit code/i);
      fireEvent.change(input, { target: { value: "123456" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(input).toHaveValue("");
      vi.useRealTimers();
    });

    it("announces step progress via a live region for keyboard/screen-reader users", () => {
      render(<TwoFactorAuthSetup onGenerateSecret={makeGenerateSecret()} onVerifyCode={makeVerifyCode()} />);
      expect(screen.getByText(/step 1 of 3/i)).toBeInTheDocument();
    });
  });

  // ── Snapshot tests (#1521) ───────────────────────────────────────────────────
  // One per reachable step, so a future markup change surfaces as an intentional
  // snapshot update rather than being caught only indirectly by behavioral tests.

  describe("snapshots", () => {
    it("matches snapshot in idle state", () => {
      const { container } = render(
        <TwoFactorAuthSetup onGenerateSecret={makeGenerateSecret()} onVerifyCode={makeVerifyCode()} />
      );
      expect(container).toMatchSnapshot();
    });

    it("matches snapshot in enabling state", () => {
      const { container } = render(
        <TwoFactorAuthSetup onGenerateSecret={makeGenerateSecret(500)} onVerifyCode={makeVerifyCode()} />
      );
      fireEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
      expect(container).toMatchSnapshot();
    });

    it("matches snapshot in scan state", async () => {
      vi.useFakeTimers();
      const { container } = render(
        <TwoFactorAuthSetup onGenerateSecret={makeGenerateSecret(0)} onVerifyCode={makeVerifyCode()} />
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
        vi.runAllTimers();
      });
      expect(container).toMatchSnapshot();
      vi.useRealTimers();
    });

    it("matches snapshot with a code entered and a network-failure retry action showing", async () => {
      vi.useFakeTimers();
      const verifyCode = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      const { container } = render(
        <TwoFactorAuthSetup onGenerateSecret={makeGenerateSecret(0)} onVerifyCode={verifyCode} />
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
        vi.runAllTimers();
      });
      fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "123456" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /verify & enable/i }));
        vi.runAllTimers();
      });
      expect(container).toMatchSnapshot();
      vi.useRealTimers();
    });

    it("matches snapshot in success state", async () => {
      vi.useFakeTimers();
      const { container } = render(
        <TwoFactorAuthSetup onGenerateSecret={makeGenerateSecret(0)} onVerifyCode={makeVerifyCode(false, 0)} />
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /enable 2fa/i }));
        vi.runAllTimers();
      });
      fireEvent.change(screen.getByLabelText(/enter 6-digit code/i), { target: { value: "123456" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /verify & enable/i }));
        vi.runAllTimers();
      });
      expect(container).toMatchSnapshot();
      vi.useRealTimers();
    });
  });
});
