import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import * as StellarSdk from "stellar-sdk";
import {
  generateChallenge,
  verifyChallenge,
  validateChallengeXdr,
  getHomeDomain,
  isRetryableSep10StoreError,
  withSep10StoreRecovery,
  lookupMerchantByStellarAddress,
  Sep10AuthError,
  generateSessionToken,
  consumeChallengeNonce,
  releaseChallengeNonce,
  MAX_CHALLENGE_XDR_BYTES,
  _resetNonceCacheForTests,
} from "./sep10-auth.js";

const HOME_DOMAIN = "localhost";

describe("SEP-0010 Authentication", () => {
  let clientKeypair;
  let serverKeypair;

  beforeAll(() => {
    process.env.JWT_SECRET = "test-jwt-secret";
    clientKeypair = StellarSdk.Keypair.random();
    serverKeypair = StellarSdk.Keypair.random();
    process.env.SEP10_SERVER_SIGNING_KEY = serverKeypair.secret();
  });

  beforeEach(() => {
    _resetNonceCacheForTests();
  });

  it("should generate a valid challenge transaction", () => {
    const challengeXdr = generateChallenge(clientKeypair.publicKey(), HOME_DOMAIN);
    expect(challengeXdr).toBeTruthy();
    expect(typeof challengeXdr).toBe("string");

    const tx = StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      StellarSdk.Networks.TESTNET,
    );
    expect(tx.operations.length).toBe(1);
    expect(tx.operations[0].type).toBe("manageData");
  });

  it("should reject an invalid client Stellar account", () => {
    expect(() => generateChallenge("not-a-valid-account", HOME_DOMAIN)).toThrow(
      "Invalid client Stellar account",
    );
  });

  it("should verify a properly signed challenge", () => {
    const challengeXdr = generateChallenge(clientKeypair.publicKey(), HOME_DOMAIN);
    const tx = StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      StellarSdk.Networks.TESTNET,
    );

    tx.sign(clientKeypair);
    const signedXdr = tx.toXDR();

    const result = verifyChallenge(signedXdr, clientKeypair.publicKey(), HOME_DOMAIN);
    expect(result.valid).toBe(true);
  });

  it("should reject challenge without client signature", () => {
    const challengeXdr = generateChallenge(clientKeypair.publicKey(), HOME_DOMAIN);

    const result = verifyChallenge(challengeXdr, clientKeypair.publicKey(), HOME_DOMAIN);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Client signature");
  });

  it("should reject challenge with wrong client account", () => {
    const wrongKeypair = StellarSdk.Keypair.random();
    const challengeXdr = generateChallenge(clientKeypair.publicKey(), HOME_DOMAIN);
    const tx = StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      StellarSdk.Networks.TESTNET,
    );

    tx.sign(clientKeypair);
    const signedXdr = tx.toXDR();

    const result = verifyChallenge(signedXdr, wrongKeypair.publicKey(), HOME_DOMAIN);
    expect(result.valid).toBe(false);
  });

  it("should reject a reused nonce (replay protection)", () => {
    const challengeXdr = generateChallenge(clientKeypair.publicKey(), HOME_DOMAIN);
    const tx = StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      StellarSdk.Networks.TESTNET,
    );

    tx.sign(clientKeypair);
    const signedXdr = tx.toXDR();

    const first = verifyChallenge(signedXdr, clientKeypair.publicKey(), HOME_DOMAIN);
    expect(first.valid).toBe(true);

    const second = verifyChallenge(signedXdr, clientKeypair.publicKey(), HOME_DOMAIN);
    expect(second.valid).toBe(false);
    expect(second.error).toBe("Challenge nonce already used");
  });

  it("should reject an invalid client account in verifyChallenge", () => {
    const result = verifyChallenge("AAAA", "not-a-key", HOME_DOMAIN);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("INVALID_ACCOUNT");
  });

  it("rejects oversized challenge XDR before parsing", () => {
    const oversized = "A".repeat(MAX_CHALLENGE_XDR_BYTES + 1);
    const result = verifyChallenge(oversized, clientKeypair.publicKey(), HOME_DOMAIN);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("INVALID_XDR");
  });

  it("rejects home-domain mismatch between challenge and verify", () => {
    const challengeXdr = generateChallenge(clientKeypair.publicKey(), "example.com");
    const tx = StellarSdk.TransactionBuilder.fromXDR(
      challengeXdr,
      StellarSdk.Networks.TESTNET,
    );
    tx.sign(clientKeypair);

    const result = verifyChallenge(tx.toXDR(), clientKeypair.publicKey(), HOME_DOMAIN);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("HOME_DOMAIN_MISMATCH");
  });

  it("validateChallengeXdr rejects non-base64 payloads", () => {
    expect(validateChallengeXdr("not valid!!!")).toEqual({
      valid: false,
      error: "Invalid challenge transaction encoding",
    });
  });

  it("getHomeDomain falls back to localhost when unset", () => {
    delete process.env.HOME_DOMAIN;
    expect(getHomeDomain()).toBe("localhost");
    process.env.HOME_DOMAIN = HOME_DOMAIN;
  });

  it("isRetryableSep10StoreError detects transient upstream failures", () => {
    expect(isRetryableSep10StoreError({ message: "fetch failed: timeout" })).toBe(true);
    expect(isRetryableSep10StoreError({ message: "duplicate key" })).toBe(false);
  });

  it("withSep10StoreRecovery retries then throws Sep10AuthError", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ message: "503 temporarily unavailable" })
      .mockRejectedValueOnce({ message: "503 temporarily unavailable" })
      .mockRejectedValueOnce({ message: "503 temporarily unavailable" });

    await expect(withSep10StoreRecovery(fn, "test")).rejects.toBeInstanceOf(Sep10AuthError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("lookupMerchantByStellarAddress returns merchant data on success", async () => {
    const merchant = { id: "m-1", email: "a@example.com" };
    const supabaseClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: merchant, error: null }),
            }),
          }),
        }),
      }),
    };

    const result = await lookupMerchantByStellarAddress(clientKeypair.publicKey(), supabaseClient);
    expect(result).toEqual(merchant);
  });

  describe("null / undefined hardening (#1293)", () => {
    function signedChallenge() {
      const tx = StellarSdk.TransactionBuilder.fromXDR(
        generateChallenge(clientKeypair.publicKey(), HOME_DOMAIN),
        StellarSdk.Networks.TESTNET,
      );
      tx.sign(clientKeypair);
      return tx;
    }

    it("rejects a fee-bump wrapped challenge instead of dereferencing missing timeBounds", () => {
      const inner = signedChallenge();
      const feeBump = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
        clientKeypair,
        "200",
        inner,
        StellarSdk.Networks.TESTNET,
      );
      feeBump.sign(clientKeypair);

      const result = verifyChallenge(feeBump.toXDR(), clientKeypair.publicKey(), HOME_DOMAIN);
      expect(result).toEqual({
        valid: false,
        error: "Invalid challenge structure",
        code: "INVALID_STRUCTURE",
      });
    });

    it("rejects a manageData challenge with a null value", () => {
      const account = new StellarSdk.Account(serverKeypair.publicKey(), "-1");
      const now = Math.floor(Date.now() / 1000);
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: StellarSdk.Networks.TESTNET,
        timebounds: { minTime: now, maxTime: now + 300 },
      })
        .addOperation(
          StellarSdk.Operation.manageData({
            name: `${HOME_DOMAIN} auth`,
            value: null,
            source: clientKeypair.publicKey(),
          }),
        )
        .build();
      tx.sign(serverKeypair);
      tx.sign(clientKeypair);

      const result = verifyChallenge(tx.toXDR(), clientKeypair.publicKey(), HOME_DOMAIN);
      expect(result.code).toBe("INVALID_NONCE");
    });

    it.each([undefined, null, 42, {}])(
      "returns INVALID_XDR for a non-string challenge (%s)",
      (value) => {
        const result = verifyChallenge(value, clientKeypair.publicKey(), HOME_DOMAIN);
        expect(result.valid).toBe(false);
        expect(result.code).toBe("INVALID_XDR");
      },
    );

    it.each([undefined, null])("returns INVALID_ACCOUNT for a %s client account", (value) => {
      const result = verifyChallenge(signedChallenge().toXDR(), value, HOME_DOMAIN);
      expect(result.code).toBe("INVALID_ACCOUNT");
    });

    it("withSep10StoreRecovery converts an undefined rejection into an Error", async () => {
      const fn = vi.fn().mockRejectedValue(undefined);

      const error = await withSep10StoreRecovery(fn, "test").catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("test failed with a non-error rejection");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("withSep10StoreRecovery keeps code/message from plain-object rejections", async () => {
      const fn = vi.fn().mockRejectedValue({ message: "duplicate key", code: "23505" });

      const error = await withSep10StoreRecovery(fn, "test").catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("duplicate key");
      expect(error.code).toBe("23505");
    });

    it("lookupMerchantByStellarAddress rejects a missing account without querying", async () => {
      const supabaseClient = { from: vi.fn() };

      await expect(lookupMerchantByStellarAddress(undefined, supabaseClient)).rejects.toMatchObject({
        code: "INVALID_ACCOUNT",
        httpStatus: 400,
      });
      expect(supabaseClient.from).not.toHaveBeenCalled();
    });

    it("lookupMerchantByStellarAddress fails clearly without a store client", async () => {
      await expect(
        lookupMerchantByStellarAddress(clientKeypair.publicKey(), null),
      ).rejects.toThrow("SEP-10 merchant lookup requires a store client");
    });

    it("lookupMerchantByStellarAddress handles an empty store response", async () => {
      const supabaseClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue(undefined),
              }),
            }),
          }),
        }),
      };

      await expect(
        lookupMerchantByStellarAddress(clientKeypair.publicKey(), supabaseClient),
      ).rejects.toThrow("SEP-10 merchant lookup returned no response");
    });

    it("lookupMerchantByStellarAddress normalises a missing merchant to null", async () => {
      const supabaseClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }),
        }),
      };

      await expect(
        lookupMerchantByStellarAddress(clientKeypair.publicKey(), supabaseClient),
      ).resolves.toBeNull();
    });

    it.each([undefined, null, ""])("refuses to issue a session token for merchant id %s", (id) => {
      expect(() => generateSessionToken(id, "a@example.com")).toThrow(
        "Cannot issue a session token without a merchant id",
      );
    });
  });

  describe("nonce claim ordering (#1295)", () => {
    function freshChallenge() {
      return StellarSdk.TransactionBuilder.fromXDR(
        generateChallenge(clientKeypair.publicKey(), HOME_DOMAIN),
        StellarSdk.Networks.TESTNET,
      );
    }

    it("an unsigned copy of a challenge does not burn the nonce for the real client", () => {
      const unsigned = freshChallenge();
      const unsignedXdr = unsigned.toXDR();

      const attacker = verifyChallenge(unsignedXdr, clientKeypair.publicKey(), HOME_DOMAIN);
      expect(attacker.code).toBe("CLIENT_SIGNATURE_INVALID");

      const signed = StellarSdk.TransactionBuilder.fromXDR(unsignedXdr, StellarSdk.Networks.TESTNET);
      signed.sign(clientKeypair);
      const legit = verifyChallenge(signed.toXDR(), clientKeypair.publicKey(), HOME_DOMAIN);
      expect(legit.valid).toBe(true);
    });

    it("a copy signed by the wrong key does not burn the nonce", () => {
      const tx = freshChallenge();
      const xdr = tx.toXDR();

      const forged = StellarSdk.TransactionBuilder.fromXDR(xdr, StellarSdk.Networks.TESTNET);
      forged.sign(StellarSdk.Keypair.random());
      expect(verifyChallenge(forged.toXDR(), clientKeypair.publicKey(), HOME_DOMAIN).valid).toBe(
        false,
      );

      tx.sign(clientKeypair);
      expect(verifyChallenge(tx.toXDR(), clientKeypair.publicKey(), HOME_DOMAIN).valid).toBe(true);
    });

    it("an expired challenge is rejected without claiming its nonce", () => {
      vi.useFakeTimers();
      try {
        const tx = freshChallenge();
        tx.sign(clientKeypair);
        const nonce = tx.operations[0].value.toString();

        vi.setSystemTime(Date.now() + 10 * 60 * 1000);
        const result = verifyChallenge(tx.toXDR(), clientKeypair.publicKey(), HOME_DOMAIN);
        expect(result.code).toBe("CHALLENGE_EXPIRED");
        expect(consumeChallengeNonce(nonce)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("returns the claimed nonce on success", () => {
      const tx = freshChallenge();
      tx.sign(clientKeypair);

      const result = verifyChallenge(tx.toXDR(), clientKeypair.publicKey(), HOME_DOMAIN);
      expect(result).toEqual({ valid: true, nonce: tx.operations[0].value.toString() });
    });

    it("consumeChallengeNonce lets exactly one caller claim a nonce", () => {
      const claims = Array.from({ length: 50 }, () => consumeChallengeNonce("n".repeat(32)));
      expect(claims.filter(Boolean)).toHaveLength(1);
    });

    it("releaseChallengeNonce makes a claimed nonce usable again", () => {
      const tx = freshChallenge();
      tx.sign(clientKeypair);
      const xdr = tx.toXDR();

      const first = verifyChallenge(xdr, clientKeypair.publicKey(), HOME_DOMAIN);
      expect(verifyChallenge(xdr, clientKeypair.publicKey(), HOME_DOMAIN).code).toBe(
        "NONCE_REPLAY",
      );

      releaseChallengeNonce(first.nonce);
      expect(verifyChallenge(xdr, clientKeypair.publicKey(), HOME_DOMAIN).valid).toBe(true);
    });

    it("releaseChallengeNonce ignores non-string input", () => {
      expect(() => releaseChallengeNonce(undefined)).not.toThrow();
      expect(() => releaseChallengeNonce(null)).not.toThrow();
    });
  });
});
