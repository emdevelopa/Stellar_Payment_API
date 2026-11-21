import { describe, expect, it } from "vitest";
import type { NetworkFeeData } from "@/hooks/useNetworkFee";
import { NETWORK_FEE_LOADING_LABEL, describeNetworkFee } from "./network-fee-a11y";

const BASE: NetworkFeeData = {
  network: "testnet",
  horizon_url: "https://horizon-testnet.stellar.org",
  operation_count: 1,
  stroops: 100,
  xlm: "0.00001",
  last_ledger_base_fee: 100,
};

describe("describeNetworkFee", () => {
  it("spells out the amount, stroops and operations", () => {
    expect(describeNetworkFee(BASE)).toBe(
      "Estimated network fee: about 0.00001 XLM, 100 stroops for 1 operation."
    );
  });

  it("pluralises operations", () => {
    expect(describeNetworkFee({ ...BASE, operation_count: 3, stroops: 300, xlm: "0.00003" })).toBe(
      "Estimated network fee: about 0.00003 XLM, 300 stroops for 3 operations."
    );
  });

  it("uses the singular for a single stroop", () => {
    expect(describeNetworkFee({ ...BASE, stroops: 1 })).toContain("1 stroop for");
  });

  it("has a loading label", () => {
    expect(NETWORK_FEE_LOADING_LABEL).toBe("Loading network fee estimate");
  });
});
