import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSep24AnchorFlow } from "./useSep24AnchorFlow";

const mockGetFreighterPublicKey = vi.fn();
const mockSignWithFreighter = vi.fn();
vi.mock("@/lib/freighter", () => ({
  getFreighterPublicKey: (...args: unknown[]) => mockGetFreighterPublicKey(...args),
  signWithFreighter: (...args: unknown[]) => mockSignWithFreighter(...args),
}));

const mockGetAnchorServices = vi.fn();
const mockAuthenticateWithAnchor = vi.fn();
const mockInitiateDeposit = vi.fn();
const mockInitiateWithdrawal = vi.fn();
vi.mock("@/lib/stellar", () => ({
  getAnchorServices: (...args: unknown[]) => mockGetAnchorServices(...args),
  authenticateWithAnchor: (...args: unknown[]) => mockAuthenticateWithAnchor(...args),
  initiateDeposit: (...args: unknown[]) => mockInitiateDeposit(...args),
  initiateWithdrawal: (...args: unknown[]) => mockInitiateWithdrawal(...args),
}));

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

describe("useSep24AnchorFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFreighterPublicKey.mockResolvedValue("GABC123PUBLICKEY");
    mockGetAnchorServices.mockResolvedValue({
      transferServer: "https://anchor.example/sep24",
      webAuthEndpoint: "https://anchor.example/auth",
      signingKey: "GSIGNINGKEY",
    });
    mockSignWithFreighter.mockResolvedValue({ signedXDR: "signed-xdr" });
    mockAuthenticateWithAnchor.mockResolvedValue("jwt-token");
    mockInitiateDeposit.mockResolvedValue("https://anchor.example/interactive/deposit");
    mockInitiateWithdrawal.mockResolvedValue("https://anchor.example/interactive/withdraw");
  });

  it("starts in the idle step", () => {
    const { result } = renderHook(() => useSep24AnchorFlow({ networkPassphrase: NETWORK_PASSPHRASE }));
    expect(result.current.step).toBe("IDLE");
    expect(result.current.isBusy).toBe(false);
    expect(result.current.interactiveUrl).toBeNull();
  });

  it("walks through CONNECTING -> AUTH -> SUBMITTING -> READY for a deposit", async () => {
    const { result } = renderHook(() => useSep24AnchorFlow({ networkPassphrase: NETWORK_PASSPHRASE }));

    let returnedUrl: string | undefined;
    await act(async () => {
      returnedUrl = await result.current.start({
        anchorDomain: "testanchor.stellar.org",
        assetCode: "USDC",
        direction: "deposit",
        amount: "100",
      });
    });

    expect(mockGetAnchorServices).toHaveBeenCalledWith("testanchor.stellar.org");
    expect(mockInitiateDeposit).toHaveBeenCalledWith(
      "https://anchor.example/sep24",
      "jwt-token",
      "USDC",
      "GABC123PUBLICKEY",
      "100",
    );
    expect(mockInitiateWithdrawal).not.toHaveBeenCalled();
    expect(returnedUrl).toBe("https://anchor.example/interactive/deposit");

    await waitFor(() => {
      expect(result.current.step).toBe("READY");
      expect(result.current.interactiveUrl).toBe("https://anchor.example/interactive/deposit");
    });
  });

  it("calls initiateWithdrawal (not initiateDeposit) for a withdrawal", async () => {
    const { result } = renderHook(() => useSep24AnchorFlow({ networkPassphrase: NETWORK_PASSPHRASE }));

    await act(async () => {
      await result.current.start({
        anchorDomain: "testanchor.stellar.org",
        assetCode: "USDC",
        direction: "withdraw",
      });
    });

    expect(mockInitiateWithdrawal).toHaveBeenCalledWith(
      "https://anchor.example/sep24",
      "jwt-token",
      "USDC",
      "GABC123PUBLICKEY",
    );
    expect(mockInitiateDeposit).not.toHaveBeenCalled();
  });

  it("resets to IDLE and rethrows when the anchor doesn't support SEP-24/SEP-10", async () => {
    mockGetAnchorServices.mockResolvedValue({ transferServer: null, webAuthEndpoint: null });
    const { result } = renderHook(() => useSep24AnchorFlow({ networkPassphrase: NETWORK_PASSPHRASE }));

    await act(async () => {
      await expect(
        result.current.start({ anchorDomain: "bad-anchor.example", assetCode: "USDC", direction: "deposit" }),
      ).rejects.toThrow("Anchor does not support SEP-0024 or SEP-0010");
    });

    expect(result.current.step).toBe("IDLE");
    expect(result.current.interactiveUrl).toBeNull();
  });

  it("resets to IDLE and rethrows when the wallet is unavailable", async () => {
    mockGetFreighterPublicKey.mockRejectedValue(new Error("Freighter is not installed"));
    const { result } = renderHook(() => useSep24AnchorFlow({ networkPassphrase: NETWORK_PASSPHRASE }));

    await act(async () => {
      await expect(
        result.current.start({ anchorDomain: "testanchor.stellar.org", assetCode: "USDC", direction: "deposit" }),
      ).rejects.toThrow("Freighter is not installed");
    });

    expect(result.current.step).toBe("IDLE");
    expect(mockGetAnchorServices).not.toHaveBeenCalled();
  });

  it("reset() clears the interactive URL and returns to IDLE", async () => {
    const { result } = renderHook(() => useSep24AnchorFlow({ networkPassphrase: NETWORK_PASSPHRASE }));

    await act(async () => {
      await result.current.start({ anchorDomain: "testanchor.stellar.org", assetCode: "USDC", direction: "deposit" });
    });
    expect(result.current.step).toBe("READY");

    act(() => {
      result.current.reset();
    });

    expect(result.current.step).toBe("IDLE");
    expect(result.current.interactiveUrl).toBeNull();
  });
});
