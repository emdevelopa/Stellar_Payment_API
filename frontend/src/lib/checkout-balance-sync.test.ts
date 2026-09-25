import { describe, expect, it } from "vitest";
import {
  didWalletAccountSwitch,
  getBalanceAmount,
  getDefaultSourceAsset,
  sortSupportedAssetsByBalance,
} from "./checkout-balance-sync";

const balances = [
  { code: "XLM", issuer: null, balance: "12.5000000" },
  { code: "USDC", issuer: "issuer", balance: "87.1000000" },
  { code: "AQUA", issuer: "issuer-2", balance: "0.5000000" },
];

describe("checkout balance sync helpers", () => {
  it("reads a known balance amount", () => {
    expect(getBalanceAmount(balances, "USDC")).toBe(87.1);
  });

  it("falls back to zero for missing balances", () => {
    expect(getBalanceAmount(balances, "EURC")).toBe(0);
  });

  it("sorts supported assets by descending wallet balance", () => {
    expect(
      sortSupportedAssetsByBalance(["AQUA", "XLM", "USDC"], balances),
    ).toEqual(["USDC", "XLM", "AQUA"]);
  });

  it("chooses the highest-balance asset as the default source", () => {
    expect(getDefaultSourceAsset(["XLM", "USDC"], balances)).toBe("USDC");
  });

  it("returns null when there are no supported source assets", () => {
    expect(getDefaultSourceAsset([], balances)).toBeNull();
  });

  it("detects when the connected wallet account changes", () => {
    expect(
      didWalletAccountSwitch(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBQ4E",
      ),
    ).toBe(true);
  });

  it("does not treat the first wallet load as an account switch", () => {
    expect(
      didWalletAccountSwitch(
        null,
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      ),
    ).toBe(false);
  });

  it("does not flag a switch when the same wallet reconnects", () => {
    expect(
      didWalletAccountSwitch(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      ),
    ).toBe(false);
  });

  it("does not flag a switch when wallet disconnects", () => {
    expect(
      didWalletAccountSwitch(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        null,
      ),
    ).toBe(false);
  });

  it("handles non-finite balance values safely", () => {
    const badBalances = [
      { code: "XLM", issuer: null, balance: "NaN" },
      { code: "USDC", issuer: "issuer", balance: "Infinity" },
    ];
    expect(getBalanceAmount(badBalances, "XLM")).toBe(0);
    expect(getBalanceAmount(badBalances, "USDC")).toBe(0);
  });

  it("sorts correctly when some assets have zero or missing balances", () => {
    const partialBalances = [
      { code: "XLM", issuer: null, balance: "5.0000000" },
    ];
    expect(
      sortSupportedAssetsByBalance(["USDC", "XLM", "AQUA"], partialBalances),
    ).toEqual(["XLM", "USDC", "AQUA"]);
  });
});
