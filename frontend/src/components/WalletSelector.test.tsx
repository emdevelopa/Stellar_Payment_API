/**
 * Tests for WalletSelector accessibility (#1849, WCAG 2.1 AA): names, descriptions, states,
 * progress announcements, errors and the QR code, for keyboard and screen reader users.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WalletSelector from "./WalletSelector";

const MESSAGES: Record<string, string> = {
  chooseWallet: "Choose a wallet",
  description: "Connect your Stellar wallet to complete this payment.",
  connecting: "Connecting...",
  walletConnectWaiting: "Waiting for wallet...",
  noProjectId: "(no project ID)",
  notInstalled: "(not installed)",
  tapToConnect: "Click to connect",
  scanTitle: "Scan with your compatible wallet app",
  scanDescription: "Scan with Freighter mobile or any WalletConnect-compatible wallet",
  userRejected: "Connection request was canceled.",
  walletConnectUnavailable: "WalletConnect is unavailable right now.",
  extensionNotFound: "Wallet extension not found.",
  noAccountFound: "No account found.",
  walletConnectFailed: "WalletConnect failed.",
  connectionFailed: "Connection failed.",
};

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => MESSAGES[key] ?? key }));

const wallet = vi.hoisted(() => ({
  providers: [] as unknown[],
  activeProvider: null as unknown,
  selectProvider: vi.fn(),
}));
vi.mock("@/lib/wallet-context", () => ({ useWallet: () => wallet }));

const connectWalletConnect = vi.hoisted(() => vi.fn());
vi.mock("@/lib/wallet-walletconnect", () => ({ connectWalletConnect }));

// The lazy QR code has its own tests; here it is a stand-in that shows what it was given.
vi.mock("./LazyQRCodeSVG", () => ({
  default: ({ value, title }: { value: string; title?: string }) => (
    <svg data-testid="qr" data-value={value} data-title={title} />
  ),
}));

function provider(id: string, name: string, available = true, extra: Record<string, unknown> = {}) {
  return { id, name, isAvailable: vi.fn(async () => available), getPublicKey: vi.fn(async () => "GKEY"), ...extra };
}

let freighter: ReturnType<typeof provider>;
let walletConnect: ReturnType<typeof provider>;
let onConnected: ReturnType<typeof vi.fn>;

function setup(options: { freighterAvailable?: boolean; walletConnectAvailable?: boolean } = {}) {
  freighter = provider("freighter", "Freighter", options.freighterAvailable ?? true);
  walletConnect = provider("walletconnect", "WalletConnect", options.walletConnectAvailable ?? true);
  wallet.providers = [freighter, walletConnect];
  wallet.activeProvider = null;
  onConnected = vi.fn();
  const user = userEvent.setup();
  render(<WalletSelector networkPassphrase="Test SDF Network" onConnected={onConnected} />);
  return { user };
}

const freighterButton = () => screen.getByRole("button", { name: "Freighter" });
const walletConnectButton = () => screen.getByRole("button", { name: "WalletConnect" });
/** Availability resolves asynchronously; wait until the buttons reflect it. */
const ready = () => screen.findByText("Browser extension wallet");

beforeEach(() => {
  wallet.selectProvider.mockClear();
  connectWalletConnect.mockReset();
});

describe("WalletSelector structure and labels", () => {
  it("groups the wallet buttons under the visible heading and description", async () => {
    setup();
    await ready();

    const group = screen.getByRole("group", { name: "Choose a wallet" });
    expect(group).toHaveAccessibleDescription("Connect your Stellar wallet to complete this payment.");
    expect(within(group).getAllByRole("button")).toHaveLength(2);
  });

  it("names each button with just the wallet's name", async () => {
    setup();
    await ready();

    expect(freighterButton()).toHaveAccessibleName("Freighter");
    expect(walletConnectButton()).toHaveAccessibleName("WalletConnect");
  });

  it("describes each button with its status line", async () => {
    setup();
    await ready();

    expect(freighterButton()).toHaveAccessibleDescription("Browser extension wallet");
    expect(walletConnectButton()).toHaveAccessibleDescription("Mobile & desktop wallets");
  });

  it("hides every decorative icon from assistive technology", async () => {
    setup();
    await ready();

    expect(screen.getAllByRole("button").flatMap((b) => Array.from(b.querySelectorAll("svg:not([aria-hidden='true'])")))).toHaveLength(0);
  });

  it("has a polite live region for connection progress that starts empty", async () => {
    setup();
    await ready();

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toBeEmptyDOMElement();
  });

  it("renders nothing once a wallet is active", () => {
    wallet.providers = [provider("freighter", "Freighter")];
    wallet.activeProvider = { id: "freighter" };
    const { container } = render(<WalletSelector networkPassphrase="x" onConnected={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("a wallet that is not installed", () => {
  it("stays focusable and says why it cannot be used", async () => {
    setup({ freighterAvailable: false });
    await screen.findByText("(not installed)");

    expect(freighterButton()).toHaveAttribute("aria-disabled", "true");
    expect(freighterButton()).not.toBeDisabled();
    expect(freighterButton()).toHaveAccessibleDescription("(not installed)");
  });

  it("can be reached with the keyboard", async () => {
    const { user } = setup({ freighterAvailable: false });
    await screen.findByText("(not installed)");

    await user.tab();

    expect(freighterButton()).toHaveFocus();
  });

  it("does nothing when activated with the mouse or the keyboard", async () => {
    const { user } = setup({ freighterAvailable: false });
    await screen.findByText("(not installed)");

    fireEvent.click(freighterButton());
    freighterButton().focus();
    await user.keyboard("{Enter}");

    expect(freighter.getPublicKey).not.toHaveBeenCalled();
    expect(wallet.selectProvider).not.toHaveBeenCalled();
  });

  it("says a missing WalletConnect project ID is the reason", async () => {
    setup({ walletConnectAvailable: false });
    await screen.findByText("(no project ID)");

    expect(walletConnectButton()).toHaveAccessibleDescription("(no project ID)");
  });

  it("links to the Freighter install page, saying it opens a new tab", async () => {
    setup({ freighterAvailable: false });
    await screen.findByText("(not installed)");

    const link = screen.getByRole("link", { name: /Install it/ });
    expect(link).toHaveAccessibleName(/\(opens in a new tab\)/);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveClass("focus-visible:ring-2");
  });

  it("offers no install link when Freighter is installed", async () => {
    setup();
    await ready();

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("connecting", () => {
  /** A Freighter connection that stays in progress until the test finishes it. */
  function holdFreighter() {
    let finish!: () => void;
    freighter.getPublicKey.mockImplementation(() => new Promise<string>((resolve) => (finish = () => resolve("GKEY"))));
    return () => finish();
  }

  it("marks the button busy and keeps the wallet's name as its name", async () => {
    const { user } = setup();
    await ready();
    holdFreighter();

    await user.click(freighterButton());

    expect(freighterButton()).toHaveAttribute("aria-busy", "true");
    expect(freighterButton()).toHaveAccessibleName("Freighter");
    expect(freighterButton()).toHaveAccessibleDescription("Connecting...");
  });

  it("announces the progress in the live region", async () => {
    const { user } = setup();
    await ready();
    holdFreighter();

    await user.click(freighterButton());

    expect(screen.getByRole("status")).toHaveTextContent("Connecting... Freighter");
  });

  it("does not let the spinner's own label leak into the button's name", async () => {
    const { user } = setup();
    await ready();
    holdFreighter();

    await user.click(freighterButton());

    expect(freighterButton().getAttribute("aria-label") ?? "").not.toMatch(/Loading/);
    expect(freighterButton()).not.toHaveAccessibleName(/Loading/);
  });

  it("disables the other wallets while one is connecting", async () => {
    const { user } = setup();
    await ready();
    holdFreighter();

    await user.click(freighterButton());

    expect(walletConnectButton()).toBeDisabled();
  });

  it("connects, then clears the announcement", async () => {
    const { user } = setup();
    await ready();
    const finish = holdFreighter();
    await user.click(freighterButton());

    await act(async () => finish());

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    expect(wallet.selectProvider).toHaveBeenCalledWith("freighter");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("WalletConnect", () => {
  it("announces progress with the WalletConnect wording", async () => {
    const { user } = setup();
    await ready();
    connectWalletConnect.mockReturnValue(new Promise(() => undefined));

    await user.click(walletConnectButton());

    expect(screen.getByRole("status")).toHaveTextContent("Waiting for wallet... WalletConnect");
  });

  it("shows the pairing QR code as a labelled group with a title", async () => {
    const { user } = setup();
    await ready();
    connectWalletConnect.mockResolvedValue({ uri: "wc:abc", approval: new Promise(() => undefined) });

    await user.click(walletConnectButton());

    const group = await screen.findByRole("group", { name: "Scan with your compatible wallet app" });
    expect(within(group).getByTestId("qr")).toHaveAttribute("data-title", "Scan with your compatible wallet app");
    expect(within(group).getByTestId("qr")).toHaveAttribute("data-value", "wc:abc");
    expect(group).toHaveTextContent("Scan with Freighter mobile or any WalletConnect-compatible wallet");
  });

  it("connects once the wallet approves", async () => {
    const { user } = setup();
    await ready();
    connectWalletConnect.mockResolvedValue({ uri: "wc:abc", approval: Promise.resolve() });

    await user.click(walletConnectButton());

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    expect(wallet.selectProvider).toHaveBeenCalledWith("walletconnect");
  });
});

describe("errors", () => {
  it("announces a rejected connection as an alert", async () => {
    const { user } = setup();
    await ready();
    freighter.getPublicKey.mockRejectedValue(new Error("User rejected the request"));

    await user.click(freighterButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Connection request was canceled.");
  });

  it("uses the alert role alone, without a conflicting aria-live", async () => {
    const { user } = setup();
    await ready();
    freighter.getPublicKey.mockRejectedValue(new Error("User rejected the request"));

    await user.click(freighterButton());

    expect(await screen.findByRole("alert")).not.toHaveAttribute("aria-live");
  });

  it("explains a missing extension", async () => {
    const { user } = setup();
    await ready();
    freighter.getPublicKey.mockRejectedValue(new Error("Extension not found"));

    await user.click(freighterButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Wallet extension not found.");
  });

  it("explains a WalletConnect failure", async () => {
    const { user } = setup();
    await ready();
    connectWalletConnect.mockRejectedValue(new Error("boom"));

    await user.click(walletConnectButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("WalletConnect failed.");
  });

  it("lets the user try again after an error, and clears the announcement", async () => {
    const { user } = setup();
    await ready();
    freighter.getPublicKey.mockRejectedValue(new Error("User rejected"));
    await user.click(freighterButton());
    await screen.findByRole("alert");

    expect(freighterButton()).not.toBeDisabled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
