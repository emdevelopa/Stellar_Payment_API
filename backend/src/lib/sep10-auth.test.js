import { describe, it, expect, beforeAll } from "vitest";
import * as StellarSdk from "stellar-sdk";
import { generateChallenge, verifyChallenge } from "./sep10-auth.js";

describe("SEP-0010 Authentication", () => {
  let clientKeypair;
  let serverKeypair;

  beforeAll(() => {
    clientKeypair = StellarSdk.Keypair.random();
    serverKeypair = StellarSdk.Keypair.random();
    process.env.SEP10_SERVER_SIGNING_KEY = serverKeypair.secret();
  });

  it("should generate a valid challenge transaction", () => {
    const challengeXdr = generateChallenge(clientKeypair.publicKey());
    expect(challengeXdr).toBeTruthy();
    expect(typeof challengeXdr).toBe("string");

    const tx = StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      StellarSdk.Networks.TESTNET,
    );
    expect(tx.operations.length).toBe(1);
    expect(tx.operations[0].type).toBe("manageData");
  });

  it("should verify a properly signed challenge", () => {
    const challengeXdr = generateChallenge(clientKeypair.publicKey());
    const tx = StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      StellarSdk.Networks.TESTNET,
    );

    tx.sign(clientKeypair);
    const signedXdr = tx.toXDR();

    const result = verifyChallenge(signedXdr, clientKeypair.publicKey());
    expect(result.valid).toBe(true);
  });

  it("should reject challenge without client signature", () => {
    const challengeXdr = generateChallenge(clientKeypair.publicKey());

    const result = verifyChallenge(challengeXdr, clientKeypair.publicKey());
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Client signature");
  });

  it("should reject challenge with wrong client account", () => {
    const wrongKeypair = StellarSdk.Keypair.random();
    const challengeXdr = generateChallenge(clientKeypair.publicKey());
    const tx = StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      StellarSdk.Networks.TESTNET,
    );

    tx.sign(clientKeypair);
    const signedXdr = tx.toXDR();

    const result = verifyChallenge(signedXdr, wrongKeypair.publicKey());
    expect(result.valid).toBe(false);
  });
});
