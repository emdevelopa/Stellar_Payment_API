/** @vitest-environment jsdom */
/**
 * Snapshot and interaction coverage for the multi-wallet connection panel.
 *
 * The panel is the checkout surface for Freighter, xBull, Albedo, and
 * WalletConnect. These tests lock rendering, keyboard and pointer behavior,
 * responsive QR sizing, failure copy (raw wallet errors stay off-screen),
 * and WCAG 2.1 AA semantics that jsdom can evaluate.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import axe from "axe-core";
import { toast } from "sonner";

import WalletSelector, { WALLET_NETWORK_TOAST_ID, isWalletNetworkFailure } from "./WalletSelector";
import { AccessibilityTester } from "@/lib/accessibility-utils";
import enMessages from "../../messages/en.json";

const copy = enMessages.walletSelector;
const NETWORK = "Test SDF Network ; September 2015";

type WalletId = "freighter" | "xbull" | "albedo" | "walletconnect" | string;

interface MockProvider {
  id: string;
  name: string;
  isAvailable: ReturnType<typeof vi.fn>;
  getPublicKey: ReturnType<typeof vi.fn>;
  signTransaction: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => {
  const selectProvider = vi.fn();
  const clearProvider = vi.fn();
  const connectWalletConnect = vi.fn();
  const walletState = {
    providers: [] as MockProvider[],
    activeProvider: null as { id: string; name: string } | null,
    selectProvider,
    clearProvider,
  };
  return { walletState, selectProvider, clearProvider, connectWalletConnect };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), dismiss: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/wallet-context", () => ({
  useWallet: () => mocks.walletState,
}));

vi.mock("@/lib/wallet-walletconnect", () => ({
  connectWalletConnect: (...args: unknown[]) => mocks.connectWalletConnect(...args),
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value, size }: { value: string; size: number }) => (
    <svg data-testid="wallet-qr-code" data-value={value} data-size={String(size)} aria-hidden="true" />
  ),
}));

const originalMatchMedia = window.matchMedia;

function setViewport(width: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("max-width") ? width <= 639 : width >= 640,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function createProvider(id: string, name: string, available = true): MockProvider {
  return {
    id,
    name,
    isAvailable: vi.fn().mockResolvedValue(available),
    getPublicKey: vi.fn().mockResolvedValue(`G${id.toUpperCase()}PUBLICKEY`),
    signTransaction: vi.fn().mockResolvedValue("signed-xdr"),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

function mountWallets(availability: Partial<Record<WalletId, boolean>> = {}) {
  const providers = [
    createProvider("freighter", "Freighter", availability.freighter ?? true),
    createProvider("xbull", "xBull", availability.xbull ?? true),
    createProvider("albedo", "Albedo", availability.albedo ?? true),
    createProvider("walletconnect", "WalletConnect", availability.walletconnect ?? true),
  ];
  mocks.walletState.providers = providers;
  mocks.walletState.activeProvider = null;
  return providers;
}

function renderSelector(onConnected: () => void = vi.fn()) {
  const view = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WalletSelector networkPassphrase={NETWORK} onConnected={onConnected} />
    </NextIntlClientProvider>,
  );
  return { ...view, onConnected };
}

function option(id: string) {
  return screen.getByTestId(`wallet-option-${id}`);
}

async function settleReady(id = "freighter") {
  await waitFor(() => {
    expect(option(id)).toHaveAttribute("data-state", "ready");
  });
}

const axeOptions = {
  rules: {
    // jsdom does not compute Tailwind colors, so contrast checks are noise here.
    "color-contrast": { enabled: false },
  },
};

async function expectNoAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, axeOptions);
  expect(results.violations).toEqual([]);
}

describe("WalletSelector", () => {
  beforeEach(() => {
    mocks.selectProvider.mockReset();
    mocks.clearProvider.mockReset();
    mocks.connectWalletConnect.mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.dismiss).mockReset();
    mocks.walletState.providers = [];
    mocks.walletState.activeProvider = null;
    setViewport(1280);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  describe("rendering", () => {
    it("renders the four wallet providers with localized names and subtitles", async () => {
      mountWallets();
      renderSelector();

      await settleReady();

      expect(screen.getByRole("region", { name: copy.chooseWallet })).toBeInTheDocument();
      expect(screen.getByText(copy.description)).toBeInTheDocument();
      expect(screen.getByRole("list", { name: copy.walletListLabel })).toBeInTheDocument();

      expect(option("freighter")).toHaveTextContent("Freighter");
      expect(option("freighter")).toHaveTextContent(copy.subtitleFreighter);
      expect(option("xbull")).toHaveTextContent("xBull");
      expect(option("xbull")).toHaveTextContent(copy.subtitleXbull);
      expect(option("albedo")).toHaveTextContent("Albedo");
      expect(option("albedo")).toHaveTextContent(copy.subtitleAlbedo);
      expect(option("walletconnect")).toHaveTextContent("WalletConnect");
      expect(option("walletconnect")).toHaveTextContent(copy.subtitleWalletConnect);
    });

    it("uses the generic subtitle and icon path for an unregistered wallet id", async () => {
      mocks.walletState.providers = [createProvider("lobstr", "Lobstr", true)];
      mocks.walletState.activeProvider = null;
      renderSelector();

      await waitFor(() => {
        expect(option("lobstr")).toHaveAttribute("data-state", "ready");
      });
      expect(option("lobstr")).toHaveTextContent(copy.tapToConnect);
      expect(option("lobstr").querySelector("svg")).toBeTruthy();
    });

    it("renders an empty list without an install link when no providers are registered", () => {
      mocks.walletState.providers = [];
      renderSelector();

      expect(screen.getByRole("list", { name: copy.walletListLabel })).toBeEmptyDOMElement();
      expect(screen.queryByTestId("wallet-install-freighter")).not.toBeInTheDocument();
    });

    it("renders nothing once a wallet is already active", async () => {
      mountWallets();
      const { rerender, onConnected } = renderSelector();
      await settleReady();

      mocks.walletState.activeProvider = { id: "freighter", name: "Freighter" };
      rerender(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <WalletSelector networkPassphrase={NETWORK} onConnected={onConnected} />
        </NextIntlClientProvider>,
      );

      expect(screen.queryByTestId("wallet-selector")).not.toBeInTheDocument();
    });

    it("shows a checking state and withholds the install link until availability resolves", () => {
      const providers = mountWallets();
      providers.forEach((provider) => {
        provider.isAvailable.mockReturnValue(new Promise(() => {}));
      });
      renderSelector();

      expect(option("freighter")).toHaveAttribute("data-state", "checking");
      expect(option("freighter")).toHaveTextContent(copy.checkingAvailability);
      expect(option("freighter")).toHaveAttribute("aria-disabled", "true");
      expect(screen.queryByTestId("wallet-install-freighter")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("availability", () => {
    it("marks a wallet unavailable when the probe returns false", async () => {
      mountWallets({ xbull: false, walletconnect: false });
      renderSelector();

      await waitFor(() => {
        expect(option("xbull")).toHaveAttribute("data-state", "unavailable");
      });

      expect(option("xbull")).toHaveTextContent(copy.notInstalled);
      expect(option("xbull")).toHaveAttribute("aria-disabled", "true");
      expect(option("xbull")).not.toBeDisabled();
      expect(option("walletconnect")).toHaveTextContent(copy.noProjectId);
      expect(option("freighter")).toHaveAttribute("data-state", "ready");
      expect(option("freighter")).not.toHaveAttribute("aria-disabled");
    });

    it("treats a thrown availability probe as not installed", async () => {
      const providers = mountWallets();
      providers[2].isAvailable.mockRejectedValue(new Error("probe exploded"));
      renderSelector();

      await waitFor(() => {
        expect(option("albedo")).toHaveAttribute("data-state", "unavailable");
      });
      expect(option("albedo")).toHaveTextContent(copy.notInstalled);
    });

    it("offers the official Freighter install link only after Freighter is confirmed missing", async () => {
      mountWallets({ freighter: false });
      renderSelector();

      const link = await screen.findByTestId("wallet-install-freighter");
      expect(link).toHaveAttribute("href", "https://freighter.app");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
      expect(link).toHaveTextContent(copy.installFreighter);
      expect(link).toHaveAccessibleName(`${copy.installFreighter} ${copy.opensNewTab}`);
      expect(link.className).toContain("underline");
    });

    it("hides the install link when Freighter is installed", async () => {
      mountWallets({ freighter: true });
      renderSelector();
      await settleReady();
      expect(screen.queryByTestId("wallet-install-freighter")).not.toBeInTheDocument();
    });
  });

  describe("pointer interactions", () => {
    it.each([
      ["freighter", "Freighter"],
      ["xbull", "xBull"],
      ["albedo", "Albedo"],
    ] as const)("connects %s through getPublicKey and notifies the caller", async (id) => {
      const providers = mountWallets();
      const onConnected = vi.fn();
      renderSelector(onConnected);
      await settleReady(id);

      fireEvent.click(option(id));

      await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
      const provider = providers.find((item) => item.id === id);
      expect(provider?.getPublicKey).toHaveBeenCalledTimes(1);
      expect(mocks.selectProvider).toHaveBeenCalledWith(id);
      expect(mocks.connectWalletConnect).not.toHaveBeenCalled();
      expect(option(id)).toHaveAttribute("data-state", "ready");
    });

    it("connects an unknown extension wallet through the same public-key path", async () => {
      const provider = createProvider("lobstr", "Lobstr", true);
      mocks.walletState.providers = [provider];
      const onConnected = vi.fn();
      renderSelector(onConnected);

      await waitFor(() => expect(option("lobstr")).toHaveAttribute("data-state", "ready"));
      fireEvent.click(option("lobstr"));

      await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
      expect(provider.getPublicKey).toHaveBeenCalledTimes(1);
      expect(mocks.selectProvider).toHaveBeenCalledWith("lobstr");
    });

    it("ignores activation while availability is unknown or the wallet is missing", async () => {
      const providers = mountWallets({ xbull: false });
      providers[0].isAvailable.mockReturnValue(new Promise(() => {}));
      renderSelector();

      fireEvent.click(option("freighter"));
      fireEvent.click(option("xbull"));

      expect(providers[0].getPublicKey).not.toHaveBeenCalled();
      expect(providers[1].getPublicKey).not.toHaveBeenCalled();
      expect(mocks.selectProvider).not.toHaveBeenCalled();
    });

    it("ignores a second click while a connection is already in flight", async () => {
      const providers = mountWallets();
      let resolveKey: (value: string) => void = () => {};
      providers[0].getPublicKey.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveKey = resolve;
        }),
      );
      const onConnected = vi.fn();
      renderSelector(onConnected);
      await settleReady();

      fireEvent.click(option("freighter"));
      fireEvent.click(option("freighter"));
      fireEvent.click(option("albedo"));

      expect(providers[0].getPublicKey).toHaveBeenCalledTimes(1);
      expect(providers[2].getPublicKey).not.toHaveBeenCalled();

      await waitFor(() => expect(option("albedo")).toBeDisabled());
      expect(screen.getByTestId("wallet-selector")).toHaveAttribute("aria-busy", "true");
      expect(option("freighter")).toHaveAttribute("aria-busy", "true");
      expect(option("freighter")).toHaveTextContent(copy.connecting);

      await act(async () => {
        resolveKey("GKEY");
      });
      await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
      expect(option("albedo")).not.toBeDisabled();
      expect(screen.getByTestId("wallet-selector")).not.toHaveAttribute("aria-busy");
    });

    it("does not throw when the panel unmounts before the wallet answers", async () => {
      const providers = mountWallets();
      let resolveKey: (value: string) => void = () => {};
      providers[0].getPublicKey.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveKey = resolve;
        }),
      );
      const { unmount } = renderSelector();
      await settleReady();
      fireEvent.click(option("freighter"));
      unmount();

      await act(async () => {
        resolveKey("GKEY");
        await Promise.resolve();
      });
      expect(mocks.selectProvider).not.toHaveBeenCalled();
    });
  });

  describe("keyboard interactions", () => {
    it("moves through wallets in order with Tab and does not trap focus", async () => {
      mountWallets();
      const user = userEvent.setup();
      renderSelector();
      await settleReady();

      await user.tab();
      expect(option("freighter")).toHaveFocus();
      await user.tab();
      expect(option("xbull")).toHaveFocus();
      await user.tab();
      expect(option("albedo")).toHaveFocus();
      await user.tab();
      expect(option("walletconnect")).toHaveFocus();
      await user.tab();
      expect(option("freighter")).not.toHaveFocus();
      expect(option("walletconnect")).not.toHaveFocus();
    });

    it("moves, wraps, and jumps with arrow, Home, and End keys", async () => {
      mountWallets();
      const user = userEvent.setup();
      renderSelector();
      await settleReady();

      option("freighter").focus();
      await user.keyboard("{ArrowDown}");
      expect(option("xbull")).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(option("albedo")).toHaveFocus();
      await user.keyboard("{ArrowUp}");
      expect(option("xbull")).toHaveFocus();
      await user.keyboard("{Home}");
      expect(option("freighter")).toHaveFocus();
      await user.keyboard("{End}");
      expect(option("walletconnect")).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(option("freighter")).toHaveFocus();
    });

    it("activates the focused wallet with Enter and Space", async () => {
      const providers = mountWallets();
      const user = userEvent.setup();
      const onConnected = vi.fn();
      renderSelector(onConnected);
      await settleReady();

      option("xbull").focus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
      expect(providers[1].getPublicKey).toHaveBeenCalledTimes(1);

      onConnected.mockClear();
      option("albedo").focus();
      await user.keyboard(" ");
      await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
      expect(providers[2].getPublicKey).toHaveBeenCalledTimes(1);
    });

    it("keeps an unavailable wallet in the arrow sequence so its status can be reached", async () => {
      mountWallets({ xbull: false });
      const user = userEvent.setup();
      renderSelector();
      await waitFor(() => expect(option("xbull")).toHaveAttribute("data-state", "unavailable"));

      option("freighter").focus();
      await user.keyboard("{ArrowDown}");
      expect(option("xbull")).toHaveFocus();
      expect(option("xbull")).toHaveTextContent(copy.notInstalled);
    });
  });

  describe("WalletConnect", () => {
    it("shows a pairing QR, then completes after the session is approved", async () => {
      mountWallets();
      let resolveApproval: () => void = () => {};
      const approval = new Promise<void>((resolve) => {
        resolveApproval = resolve;
      });
      mocks.connectWalletConnect.mockResolvedValue({
        uri: "wc:secret-pairing-uri",
        approval,
      });
      const onConnected = vi.fn();
      renderSelector(onConnected);
      await settleReady("walletconnect");

      fireEvent.click(option("walletconnect"));

      const qr = await screen.findByTestId("wallet-connect-qr");
      expect(qr).toHaveAttribute("aria-live", "polite");
      expect(within(qr).getByRole("img", { name: copy.qrLabel })).toBeInTheDocument();
      expect(screen.getByTestId("wallet-qr-code")).toHaveAttribute("data-value", "wc:secret-pairing-uri");
      expect(screen.getByTestId("wallet-qr-code")).toHaveAttribute("data-size", "200");
      expect(qr).toHaveTextContent(copy.scanTitle);
      expect(qr).toHaveTextContent(copy.scanDescription);
      expect(qr.textContent).not.toContain("wc:secret-pairing-uri");
      expect(option("walletconnect")).toHaveTextContent(copy.walletConnectWaiting);
      expect(onConnected).not.toHaveBeenCalled();

      await act(async () => {
        resolveApproval();
      });
      await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
      expect(mocks.connectWalletConnect).toHaveBeenCalledWith(NETWORK);
      expect(mocks.selectProvider).toHaveBeenCalledWith("walletconnect");
      expect(screen.queryByTestId("wallet-connect-qr")).not.toBeInTheDocument();
    });

    it("uses a smaller QR code on compact viewports", async () => {
      setViewport(375);
      mountWallets();
      const onConnected = vi.fn();
      renderSelector(onConnected);
      await waitFor(() => {
        expect(screen.getByTestId("wallet-selector")).toHaveAttribute("data-viewport", "compact");
      });
      await settleReady("walletconnect");

      mocks.connectWalletConnect.mockResolvedValue({
        uri: "wc:compact-uri",
        approval: new Promise(() => {}),
      });
      fireEvent.click(option("walletconnect"));

      const code = await screen.findByTestId("wallet-qr-code");
      expect(code).toHaveAttribute("data-size", "160");
      expect(screen.getByTestId("wallet-selector")).toHaveAttribute("data-viewport", "compact");
      expect(onConnected).not.toHaveBeenCalled();
    });

    it("drops the QR and shows a friendly error when approval fails", async () => {
      mountWallets();
      let rejectApproval: (reason: unknown) => void = () => {};
      const approval = new Promise<void>((_resolve, reject) => {
        rejectApproval = reject;
      });
      mocks.connectWalletConnect.mockResolvedValue({
        uri: "wc:secret-pairing-uri",
        approval,
      });
      const onConnected = vi.fn();
      renderSelector(onConnected);
      await settleReady("walletconnect");
      fireEvent.click(option("walletconnect"));
      await screen.findByTestId("wallet-connect-qr");

      await act(async () => {
        rejectApproval(new Error("User rejected the request"));
      });

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(copy.userRejected);
      expect(alert.textContent).not.toContain("User rejected");
      expect(screen.queryByTestId("wallet-connect-qr")).not.toBeInTheDocument();
      expect(onConnected).not.toHaveBeenCalled();
      expect(mocks.selectProvider).not.toHaveBeenCalled();
    });
  });

  describe("error mapping", () => {
    const cases: Array<[string, string, keyof typeof copy]> = [
      ["freighter", "User rejected the request", "userRejected"],
      ["freighter", "The user declined", "userRejected"],
      ["freighter", "Access denied", "userRejected"],
      ["freighter", "Request canceled", "userRejected"],
      ["freighter", "Request cancelled", "userRejected"],
      ["freighter", "Error code 4001", "userRejected"],
      ["freighter", "Freighter extension not found", "extensionNotFound"],
      ["freighter", "Wallet is not installed", "extensionNotFound"],
      ["freighter", "No Stellar accounts returned", "noAccountFound"],
      ["freighter", "Missing public key", "noAccountFound"],
      ["freighter", "Session not established", "noAccountFound"],
      ["freighter", "socket hang up", "networkFailure"],
      ["freighter", "<img src=x onerror=alert(1)>", "connectionFailed"],
      ["walletconnect", "Missing project_id", "walletConnectUnavailable"],
      ["walletconnect", "Set a WalletConnect project id", "walletConnectUnavailable"],
      ["walletconnect", "WalletConnect is disabled", "walletConnectUnavailable"],
      ["walletconnect", "No pairing URI", "walletConnectUnavailable"],
      ["walletconnect", "handshake timeout", "networkFailure"],
    ];

    it.each(cases)("maps %s error %j to %s and does not echo the raw message", async (id, raw, key) => {
      const providers = mountWallets();
      if (id === "walletconnect") {
        mocks.connectWalletConnect.mockRejectedValue(new Error(raw));
      } else {
        providers[0].getPublicKey.mockRejectedValue(new Error(raw));
      }
      const onConnected = vi.fn();
      renderSelector(onConnected);
      await settleReady(id);

      fireEvent.click(option(id));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(copy[key]);
      expect(alert.textContent).not.toContain(raw);
      expect(alert).toHaveAttribute("aria-live", "assertive");
      expect(alert.className).toContain("text-red-800");
      expect(alert.className).toContain("bg-red-50");
      expect(onConnected).not.toHaveBeenCalled();
      expect(mocks.selectProvider).not.toHaveBeenCalled();
      if (key === "networkFailure") {
        expect(option(id)).toHaveAttribute("data-state", "rolled-back");
        expect(toast.error).toHaveBeenCalledWith(copy.networkFailure, {
          id: WALLET_NETWORK_TOAST_ID,
          description: copy.networkFailureHint,
        });
        expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain(raw);
      } else {
        expect(toast.error).not.toHaveBeenCalled();
        expect(option(id)).not.toHaveAttribute("data-state", "rolled-back");
      }
    });

    it("maps a non-Error rejection to the generic connection failure", async () => {
      const providers = mountWallets();
      providers[0].getPublicKey.mockRejectedValue("nope");
      renderSelector();
      await settleReady();
      fireEvent.click(option("freighter"));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(copy.connectionFailed);
      expect(alert.textContent).not.toContain("nope");
    });

    it("clears the previous error as soon as a retry starts and succeeds", async () => {
      const providers = mountWallets();
      providers[0].getPublicKey.mockRejectedValueOnce(new Error("socket hang up"));
      const onConnected = vi.fn();
      renderSelector(onConnected);
      await settleReady();

      fireEvent.click(option("freighter"));
      await screen.findByRole("alert");

      let resolveKey: (value: string) => void = () => {};
      providers[0].getPublicKey.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveKey = resolve;
        }),
      );
      fireEvent.click(option("freighter"));

      await waitFor(() => {
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });
      expect(option("freighter")).toHaveAttribute("data-state", "connecting");

      await act(async () => {
        resolveKey("GKEY");
      });
      await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("optimistic rollback", () => {
    function setOnline(online: boolean) {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        get: () => online,
      });
    }

    afterEach(() => {
      setOnline(true);
    });

    it("classifies transport failures without treating cancellation as a network error", () => {
      expect(isWalletNetworkFailure(new Error("Failed to fetch"))).toBe(true);
      expect(isWalletNetworkFailure(new Error("User rejected the network request"))).toBe(false);
      expect(isWalletNetworkFailure(new Error("WalletConnect is disabled"))).toBe(false);
    });

    it("shows an optimistic selection before the provider is committed", async () => {
      const providers = mountWallets();
      let resolveKey: (value: string) => void = () => {};
      providers[0].getPublicKey.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveKey = resolve;
        }),
      );
      const onConnected = vi.fn();
      renderSelector(onConnected);
      await settleReady();

      fireEvent.click(option("freighter"));
      await waitFor(() => expect(option("freighter")).toHaveAttribute("data-optimistic", "true"));
      expect(option("freighter")).toHaveAttribute("data-state", "connecting");
      expect(option("freighter")).toHaveAttribute("aria-pressed", "true");
      expect(mocks.selectProvider).not.toHaveBeenCalled();

      await act(async () => {
        resolveKey("GKEY");
      });
      await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
      expect(mocks.selectProvider).toHaveBeenCalledWith("freighter");
      expect(toast.error).not.toHaveBeenCalled();
      expect(option("freighter")).not.toHaveAttribute("data-optimistic");
    });

    it("rolls back when the browser is offline and does not call the wallet", async () => {
      const providers = mountWallets();
      setOnline(false);
      renderSelector();
      await settleReady("albedo");

      fireEvent.click(option("albedo"));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(copy.networkFailure);
      expect(alert.textContent).not.toContain("offline");
      expect(providers[2].getPublicKey).not.toHaveBeenCalled();
      expect(option("albedo")).toHaveAttribute("data-state", "rolled-back");
      expect(option("albedo")).toHaveTextContent(copy.reverted);
      expect(toast.error).toHaveBeenCalledWith(
        copy.networkFailure,
        expect.objectContaining({ id: WALLET_NETWORK_TOAST_ID, description: copy.networkFailureHint }),
      );
    });

    it("removes the WalletConnect QR and toasts when pairing fails on the network", async () => {
      mountWallets();
      let rejectApproval: (reason: unknown) => void = () => {};
      const approval = new Promise<void>((_resolve, reject) => {
        rejectApproval = reject;
      });
      mocks.connectWalletConnect.mockResolvedValue({
        uri: "wc:secret-pairing-uri",
        approval,
      });
      renderSelector();
      await settleReady("walletconnect");
      fireEvent.click(option("walletconnect"));
      const qr = await screen.findByTestId("wallet-connect-qr");
      expect(qr.textContent).not.toContain("wc:secret-pairing-uri");
      expect(option("walletconnect")).toHaveAttribute("data-optimistic", "true");

      await act(async () => {
        rejectApproval(new Error("socket hang up"));
      });

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(copy.networkFailure);
      expect(alert.textContent).not.toContain("socket hang up");
      expect(screen.queryByTestId("wallet-connect-qr")).not.toBeInTheDocument();
      expect(option("walletconnect")).toHaveAttribute("data-rolled-back", "true");
      expect(mocks.selectProvider).not.toHaveBeenCalled();
      expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain("wc:secret");
    });

    it("dismisses the network toast when a rolled-back wallet is retried", async () => {
      const providers = mountWallets();
      providers[2].getPublicKey.mockRejectedValueOnce(new Error("Failed to fetch"));
      renderSelector();
      await settleReady("albedo");
      fireEvent.click(option("albedo"));
      await screen.findByRole("alert");

      let resolveKey: (value: string) => void = () => {};
      providers[2].getPublicKey.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveKey = resolve;
        }),
      );
      fireEvent.click(option("albedo"));
      await waitFor(() => expect(option("albedo")).toHaveAttribute("data-optimistic", "true"));
      expect(toast.dismiss).toHaveBeenCalledWith(WALLET_NETWORK_TOAST_ID);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      await act(async () => {
        resolveKey("GKEY");
      });
      await waitFor(() => expect(mocks.selectProvider).toHaveBeenCalledWith("albedo"));
      expect(option("albedo")).toHaveAttribute("data-state", "ready");
    });

    it("does not toast after the panel unmounts during a network failure", async () => {
      const providers = mountWallets();
      let rejectKey: (reason?: unknown) => void = () => {};
      providers[0].getPublicKey.mockReturnValue(
        new Promise<string>((_resolve, reject) => {
          rejectKey = reject;
        }),
      );
      const view = renderSelector();
      await settleReady();
      fireEvent.click(option("freighter"));
      await waitFor(() => expect(option("freighter")).toHaveAttribute("data-optimistic", "true"));
      view.unmount();
      await act(async () => {
        rejectKey(new Error("Failed to fetch"));
      });
      expect(toast.error).not.toHaveBeenCalled();
      expect(mocks.selectProvider).not.toHaveBeenCalled();
    });
  });

  describe("responsive layout", () => {
    it("uses full-width touch targets and a regular viewport on desktop", async () => {
      mountWallets();
      renderSelector();
      await settleReady();

      const panel = screen.getByTestId("wallet-selector");
      expect(panel).toHaveAttribute("data-viewport", "regular");
      expect(panel.className).toContain("w-full");
      expect(panel.className).toContain("max-w-full");

      const button = option("freighter");
      expect(button.className).toContain("min-h-16");
      expect(button.className).toContain("w-full");
      expect(button.className).toContain("touch-manipulation");
      expect(button.className).toContain("focus-visible:ring-2");
      expect(button.className).toContain("motion-reduce:transition-none");
    });

    it("flags compact layout at a phone width", async () => {
      setViewport(375);
      mountWallets();
      renderSelector();

      await waitFor(() => {
        expect(screen.getByTestId("wallet-selector")).toHaveAttribute("data-viewport", "compact");
      });
      expect(option("freighter").className).toContain("sm:px-5");
    });
  });

  describe("accessibility", () => {
    it("names each ready wallet from its visible label and description", async () => {
      mountWallets();
      renderSelector();
      await settleReady();

      for (const [id, subtitle] of [
        ["freighter", copy.subtitleFreighter],
        ["xbull", copy.subtitleXbull],
        ["albedo", copy.subtitleAlbedo],
        ["walletconnect", copy.subtitleWalletConnect],
      ] as const) {
        const button = option(id);
        const describedBy = button.getAttribute("aria-describedby");
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy!)).toHaveTextContent(subtitle);
        const audit = AccessibilityTester.checkAriaAttributes(button);
        expect(audit.valid).toBe(true);
      }

      const regionAudit = AccessibilityTester.checkAriaAttributes(
        screen.getByRole("region", { name: copy.chooseWallet }),
      );
      expect(regionAudit.valid).toBe(true);
    });

    it("hides decorative icons from assistive technology", async () => {
      mountWallets();
      renderSelector();
      await settleReady();

      const icons = option("freighter").querySelectorAll("svg");
      expect(icons.length).toBeGreaterThan(0);
      icons.forEach((icon) => {
        expect(icon).toHaveAttribute("aria-hidden", "true");
        expect(icon).toHaveAttribute("focusable", "false");
      });
    });

    it("has no axe violations when every wallet is ready", async () => {
      mountWallets();
      const { container } = renderSelector();
      await settleReady();
      await expectNoAxeViolations(container);
    });

    it("has no axe violations while checking, unavailable, connecting, failed, or showing a QR", async () => {
      const pending = mountWallets();
      pending.forEach((provider) => {
        provider.isAvailable.mockReturnValue(new Promise(() => {}));
      });
      const checking = renderSelector();
      await expectNoAxeViolations(checking.container);
      checking.unmount();

      mountWallets({ freighter: false, xbull: false });
      const unavailable = renderSelector();
      await screen.findByTestId("wallet-install-freighter");
      await expectNoAxeViolations(unavailable.container);
      unavailable.unmount();

      const connectingProviders = mountWallets();
      connectingProviders[0].getPublicKey.mockReturnValue(new Promise(() => {}));
      const connecting = renderSelector();
      await settleReady();
      fireEvent.click(option("freighter"));
      await waitFor(() => expect(option("freighter")).toHaveAttribute("data-state", "connecting"));
      await expectNoAxeViolations(connecting.container);
      connecting.unmount();

      const failing = mountWallets();
      failing[0].getPublicKey.mockRejectedValue(new Error("<script>alert(1)</script>"));
      const failed = renderSelector();
      await settleReady();
      fireEvent.click(option("freighter"));
      await screen.findByRole("alert");
      await expectNoAxeViolations(failed.container);
      failed.unmount();

      setViewport(375);
      mountWallets();
      mocks.connectWalletConnect.mockResolvedValue({
        uri: "wc:axe-uri",
        approval: new Promise(() => {}),
      });
      const qr = renderSelector();
      await waitFor(() => {
        expect(screen.getByTestId("wallet-selector")).toHaveAttribute("data-viewport", "compact");
      });
      await settleReady("walletconnect");
      fireEvent.click(option("walletconnect"));
      await screen.findByTestId("wallet-connect-qr");
      await expectNoAxeViolations(qr.container);
    });
  });

  describe("snapshots", () => {
    it("matches the checking snapshot", () => {
      const providers = mountWallets();
      providers.forEach((provider) => {
        provider.isAvailable.mockReturnValue(new Promise(() => {}));
      });
      const { container } = renderSelector();
      expect(container).toMatchSnapshot();
    });

    it("matches the desktop ready snapshot", async () => {
      mountWallets();
      const { container } = renderSelector();
      await settleReady();
      expect(container).toMatchSnapshot();
    });

    it("matches the unavailable snapshot, including the Freighter install link", async () => {
      mountWallets({ freighter: false, walletconnect: false });
      const { container } = renderSelector();
      await screen.findByTestId("wallet-install-freighter");
      expect(container).toMatchSnapshot();
    });

    it("matches the connecting snapshot", async () => {
      const providers = mountWallets();
      providers[0].getPublicKey.mockReturnValue(new Promise(() => {}));
      const { container } = renderSelector();
      await settleReady();
      fireEvent.click(option("freighter"));
      await waitFor(() => expect(option("freighter")).toHaveTextContent(copy.connecting));
      expect(container).toMatchSnapshot();
    });

    it("matches the error snapshot", async () => {
      const providers = mountWallets();
      providers[0].getPublicKey.mockRejectedValue(new Error("socket hang up"));
      const { container } = renderSelector();
      await settleReady();
      fireEvent.click(option("freighter"));
      await screen.findByRole("alert");
      expect(container).toMatchSnapshot();
    });

    it("matches the desktop WalletConnect QR snapshot", async () => {
      mountWallets();
      mocks.connectWalletConnect.mockResolvedValue({
        uri: "wc:snapshot-desktop",
        approval: new Promise(() => {}),
      });
      const { container } = renderSelector();
      await settleReady("walletconnect");
      fireEvent.click(option("walletconnect"));
      await screen.findByTestId("wallet-qr-code");
      expect(container).toMatchSnapshot();
    });

    it("matches the compact mobile QR snapshot", async () => {
      setViewport(390);
      mountWallets();
      mocks.connectWalletConnect.mockResolvedValue({
        uri: "wc:snapshot-mobile",
        approval: new Promise(() => {}),
      });
      const { container } = renderSelector();
      await waitFor(() => {
        expect(screen.getByTestId("wallet-selector")).toHaveAttribute("data-viewport", "compact");
      });
      await settleReady("walletconnect");
      fireEvent.click(option("walletconnect"));
      const code = await screen.findByTestId("wallet-qr-code");
      expect(code).toHaveAttribute("data-size", "160");
      expect(container).toMatchSnapshot();
    });

    it("matches the connected snapshot, which renders nothing", () => {
      mountWallets();
      mocks.walletState.activeProvider = { id: "freighter", name: "Freighter" };
      const { container } = renderSelector();
      expect(screen.queryByTestId("wallet-selector")).not.toBeInTheDocument();
      expect(container).toMatchSnapshot();
    });
  });
});
