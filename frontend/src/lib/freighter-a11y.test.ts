// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("stellar-sdk", () => ({ Horizon: { Server: vi.fn() }, TransactionBuilder: { fromXDR: vi.fn() } }));
vi.mock("@stellar/freighter-api", () => ({
  isConnected: vi.fn(),
  setAllowed: vi.fn(),
  getPublicKey: vi.fn(),
  signTransaction: vi.fn(),
}));

import * as freighterApi from "@stellar/freighter-api";
import {
  announceWalletStatus,
  withFocusRestore,
  getFreighterPublicKey,
  FREIGHTER_A11Y_LABELS,
} from "./freighter";

const region = () => document.getElementById("freighter-a11y-live-region");

describe("freighter accessibility helpers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("creates one visually hidden live region and reuses it", () => {
    announceWalletStatus("one");
    announceWalletStatus("two");
    expect(document.querySelectorAll("#freighter-a11y-live-region")).toHaveLength(1);
    expect(region()?.getAttribute("role")).toBe("status");
    expect(region()?.textContent).toBe("two");
  });

  it("supports assertive politeness", () => {
    announceWalletStatus("bad", "assertive");
    expect(region()?.getAttribute("aria-live")).toBe("assertive");
  });

  it("restores focus to the originating element after the action", async () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();
    await withFocusRestore(async () => {
      btn.blur();
    });
    expect(document.activeElement).toBe(btn);
  });

  it("restores focus even when the action throws", async () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();
    await expect(
      withFocusRestore(async () => {
        btn.blur();
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(document.activeElement).toBe(btn);
  });

  it("announces connecting then connected on success", async () => {
    vi.mocked(freighterApi.isConnected).mockResolvedValue(true as never);
    vi.mocked(freighterApi.setAllowed).mockResolvedValue(true as never);
    vi.mocked(freighterApi.getPublicKey).mockResolvedValue("GKEY" as never);
    await expect(getFreighterPublicKey()).resolves.toBe("GKEY");
    expect(region()?.textContent).toBe(FREIGHTER_A11Y_LABELS.connected);
  });

  it("announces failure assertively when the wallet is unavailable", async () => {
    vi.mocked(freighterApi.isConnected).mockResolvedValue(false as never);
    await expect(getFreighterPublicKey()).rejects.toThrow();
    expect(region()?.getAttribute("aria-live")).toBe("assertive");
    expect(region()?.textContent).toContain(FREIGHTER_A11Y_LABELS.failed);
  });
});
