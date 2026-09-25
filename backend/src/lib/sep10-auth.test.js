import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import * as StellarSdk from "stellar-sdk";
import jwt from "jsonwebtoken";
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
  verifySessionToken,
  consumeChallengeNonce,
  releaseChallengeNonce,
  pruneExpiredNonces,
  NONCE_SWEEP_INTERVAL_MS,
  CHALLENGE_EXPIRES_IN,
  _getNonceCacheStatsForTests,
  MAX_CHALLENGE_XDR_BYTES,
  _resetNonceCacheForTests,
  verifyChallengeSignatures,
  SEP10_MAX_CHALLENGE_SIGNATURES,
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

  it("lookupMerchantByStellarAddress scopes to active merchants and fetches at most 2 rows (#586)", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "m-1" }, error: null });
    const limit = vi.fn().mockReturnValue({ maybeSingle });
    const is = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ is });
    const select = vi.fn().mockReturnValue({ eq });
    const supabaseClient = { from: vi.fn().mockReturnValue({ select }) };
    const account = clientKeypair.publicKey();

    await lookupMerchantByStellarAddress(account, supabaseClient);

    expect(supabaseClient.from).toHaveBeenCalledWith("merchants");
    // Only the columns covered by idx_merchants_sep10_active_recipient.
    expect(select).toHaveBeenCalledWith("id, email, business_name, notification_email");
    expect(eq).toHaveBeenCalledWith("recipient", account);
    expect(is).toHaveBeenCalledWith("deleted_at", null);
    // Two rows suffice to detect an ambiguous address (PGRST116).
    expect(limit).toHaveBeenCalledWith(2);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("lookupMerchantByStellarAddress returns merchant data on success", async () => {
    const merchant = { id: "m-1", email: "a@example.com" };
    const supabaseClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: merchant, error: null }),
              }),
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
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue(undefined),
                }),
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
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ error: null }),
                }),
              }),
            }),
          }),
        }),
      };

      await expect(
        lookupMerchantByStellarAddress(clientKeypair.publicKey(), supabaseClient),
      ).resolves.toBeNull();
    });

    it("lookupMerchantByStellarAddress rejects an address shared by several merchants (#1296)", async () => {
      const supabaseClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: { code: "PGRST116", message: "multiple (or no) rows returned" },
                  }),
                }),
              }),
            }),
          }),
        }),
      };

      await expect(
        lookupMerchantByStellarAddress(clientKeypair.publicKey(), supabaseClient),
      ).rejects.toMatchObject({ code: "AMBIGUOUS_MERCHANT", httpStatus: 409 });
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

  describe("nonce cache memory bounds (#1292)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      delete process.env.SEP10_NONCE_CACHE_MAX;
    });

    function verifyFresh() {
      const tx = StellarSdk.TransactionBuilder.fromXDR(
        generateChallenge(clientKeypair.publicKey(), HOME_DOMAIN),
        StellarSdk.Networks.TESTNET,
      );
      tx.sign(clientKeypair);
      const xdr = tx.toXDR();
      expect(verifyChallenge(xdr, clientKeypair.publicKey(), HOME_DOMAIN).valid).toBe(true);
      return xdr;
    }

    it("the periodic sweep drops nonces once their challenge has expired", () => {
      verifyFresh();
      verifyFresh();
      expect(_getNonceCacheStatsForTests()).toEqual({ size: 2, sweeping: true });

      vi.advanceTimersByTime((CHALLENGE_EXPIRES_IN + 1) * 1000 + NONCE_SWEEP_INTERVAL_MS);

      expect(_getNonceCacheStatsForTests()).toEqual({ size: 0, sweeping: false });
    });

    it("the sweep keeps nonces of still-valid challenges, so replay stays blocked", () => {
      const xdr = verifyFresh();

      vi.advanceTimersByTime(NONCE_SWEEP_INTERVAL_MS * 3);

      expect(_getNonceCacheStatsForTests().size).toBe(1);
      expect(verifyChallenge(xdr, clientKeypair.publicKey(), HOME_DOMAIN).code).toBe(
        "NONCE_REPLAY",
      );
    });

    it("a replayed challenge is still rejected after its nonce is swept", () => {
      const xdr = verifyFresh();

      vi.advanceTimersByTime((CHALLENGE_EXPIRES_IN + 1) * 1000 + NONCE_SWEEP_INTERVAL_MS);
      expect(_getNonceCacheStatsForTests().size).toBe(0);

      expect(verifyChallenge(xdr, clientKeypair.publicKey(), HOME_DOMAIN).code).toBe(
        "CHALLENGE_EXPIRED",
      );
    });

    it("never grows past the configured cap", () => {
      process.env.SEP10_NONCE_CACHE_MAX = "5";
      const expiresAt = Math.floor(Date.now() / 1000) + CHALLENGE_EXPIRES_IN;

      for (let i = 0; i < 50; i += 1) {
        expect(consumeChallengeNonce(`nonce-${i}`.padEnd(32, "x"), expiresAt)).toBe(true);
      }

      expect(_getNonceCacheStatsForTests().size).toBe(5);
      // Most recent nonces are retained.
      expect(consumeChallengeNonce("nonce-49".padEnd(32, "x"), expiresAt)).toBe(false);
    });

    it("evicts expired entries before live ones when the cap is reached", () => {
      process.env.SEP10_NONCE_CACHE_MAX = "3";
      const nowSec = Math.floor(Date.now() / 1000);

      consumeChallengeNonce("live".padEnd(32, "x"), nowSec + CHALLENGE_EXPIRES_IN);
      consumeChallengeNonce("stale-1".padEnd(32, "x"), nowSec + 1);
      consumeChallengeNonce("stale-2".padEnd(32, "x"), nowSec + 1);

      vi.setSystemTime(Date.now() + 5_000);
      consumeChallengeNonce("new".padEnd(32, "x"), nowSec + CHALLENGE_EXPIRES_IN);

      expect(_getNonceCacheStatsForTests().size).toBe(2);
      expect(consumeChallengeNonce("live".padEnd(32, "x"))).toBe(false);
    });

    it("pruneExpiredNonces reports how many entries were removed", () => {
      const nowSec = Math.floor(Date.now() / 1000);
      consumeChallengeNonce("a".repeat(32), nowSec + 1);
      consumeChallengeNonce("b".repeat(32), nowSec + CHALLENGE_EXPIRES_IN);

      expect(pruneExpiredNonces(Date.now() + 10_000)).toBe(1);
      expect(_getNonceCacheStatsForTests().size).toBe(1);
    });

    it("stops the sweep timer when the cache empties", () => {
      consumeChallengeNonce("a".repeat(32));
      expect(_getNonceCacheStatsForTests().sweeping).toBe(true);

      releaseChallengeNonce("a".repeat(32));
      expect(_getNonceCacheStatsForTests()).toEqual({ size: 0, sweeping: false });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("ignores an invalid SEP10_NONCE_CACHE_MAX", () => {
      process.env.SEP10_NONCE_CACHE_MAX = "not-a-number";
      for (let i = 0; i < 20; i += 1) consumeChallengeNonce(`n-${i}`.padEnd(32, "x"));
      expect(_getNonceCacheStatsForTests().size).toBe(20);
    });
  });

  describe("SEP-10 challenge integrity (#1294)", () => {
    /** Build a server-signed challenge with overridable envelope fields. */
    function customChallenge({
      source = serverKeypair,
      sequence = "-1",
      minTime,
      maxTime,
      signers = [serverKeypair, clientKeypair],
    } = {}) {
      const now = Math.floor(Date.now() / 1000);
      const tx = new StellarSdk.TransactionBuilder(
        new StellarSdk.Account(source.publicKey(), sequence),
        {
          fee: "100",
          networkPassphrase: StellarSdk.Networks.TESTNET,
          timebounds: { minTime: minTime ?? now, maxTime: maxTime ?? now + CHALLENGE_EXPIRES_IN },
        },
      )
        .addOperation(
          StellarSdk.Operation.manageData({
            name: `${HOME_DOMAIN} auth`,
            value: "n".repeat(48),
            source: clientKeypair.publicKey(),
          }),
        )
        .build();
      signers.forEach((kp) => tx.sign(kp));
      return tx.toXDR();
    }

    const verify = (xdr) => verifyChallenge(xdr, clientKeypair.publicKey(), HOME_DOMAIN);

    it("accepts a well-formed custom challenge (control)", () => {
      expect(verify(customChallenge()).valid).toBe(true);
    });

    it("rejects a challenge whose source account is not the server", () => {
      const other = StellarSdk.Keypair.random();
      const result = verify(customChallenge({ source: other }));
      expect(result).toMatchObject({ valid: false, code: "INVALID_STRUCTURE" });
      expect(result.error).toBe("Challenge was not issued by this server");
    });

    it("rejects a challenge with a non-zero sequence number", () => {
      expect(verify(customChallenge({ sequence: "41" })).code).toBe("INVALID_STRUCTURE");
    });

    it("rejects a challenge with an unbounded maxTime", () => {
      expect(verify(customChallenge({ maxTime: 0 })).code).toBe("INVALID_TIME_BOUNDS");
    });

    it("rejects a challenge valid for longer than CHALLENGE_EXPIRES_IN", () => {
      const now = Math.floor(Date.now() / 1000);
      const result = verify(customChallenge({ minTime: now, maxTime: now + 86_400 }));
      expect(result.code).toBe("INVALID_TIME_BOUNDS");
    });

    it("rejects a challenge carrying a third-party signature", () => {
      const intruder = StellarSdk.Keypair.random();
      const result = verify(customChallenge({ signers: [serverKeypair, clientKeypair, intruder] }));
      expect(result.code).toBe("UNRECOGNIZED_SIGNATURE");
    });

    it("does not consume the nonce of a rejected challenge", () => {
      const intruder = StellarSdk.Keypair.random();
      verify(customChallenge({ signers: [serverKeypair, clientKeypair, intruder] }));
      expect(verify(customChallenge()).valid).toBe(true);
    });

    it("issues HS256 session tokens", () => {
      const token = generateSessionToken("m-1", "a@example.com");
      expect(jwt.decode(token, { complete: true }).header.alg).toBe("HS256");
      expect(verifySessionToken(token)).toMatchObject({ valid: true, payload: { id: "m-1" } });
    });

    it("rejects session tokens signed with a different HMAC algorithm", () => {
      const token = jwt.sign({ id: "m-1", merchant_id: "m-1" }, process.env.JWT_SECRET, {
        algorithm: "HS512",
      });
      expect(verifySessionToken(token).valid).toBe(false);
    });

    it("rejects unsigned (alg: none) session tokens", () => {
      const token = jwt.sign({ id: "m-1", merchant_id: "m-1" }, null, { algorithm: "none" });
      expect(verifySessionToken(token).valid).toBe(false);
    });
  });
});

describe("verifyChallengeSignatures (#585)", () => {
  const server = StellarSdk.Keypair.random();
  const client = StellarSdk.Keypair.random();

  function unsignedChallenge(nonce = "a".repeat(48)) {
    const now = Math.floor(Date.now() / 1000);
    return new StellarSdk.TransactionBuilder(new StellarSdk.Account(server.publicKey(), "-1"), {
      fee: "100",
      networkPassphrase: StellarSdk.Networks.TESTNET,
      timebounds: { minTime: now, maxTime: now + CHALLENGE_EXPIRES_IN },
    })
      .addOperation(
        StellarSdk.Operation.manageData({
          name: `${HOME_DOMAIN} auth`,
          value: nonce,
          source: client.publicKey(),
        }),
      )
      .build();
  }

  /** A signature carrying `keypair`'s hint but bytes that don't verify. */
  function forgedSignatureFor(keypair) {
    return new StellarSdk.xdr.DecoratedSignature({
      hint: keypair.signatureHint(),
      signature: Buffer.alloc(64, 7),
    });
  }

  function signed(...signers) {
    const tx = unsignedChallenge();
    for (const signer of signers) tx.sign(signer);
    return tx;
  }

  it("accepts exactly the server and client signatures, in either order", () => {
    expect(verifyChallengeSignatures(signed(server, client), server, client)).toEqual({ valid: true });
    expect(verifyChallengeSignatures(signed(client, server), server, client)).toEqual({ valid: true });
  });

  it("verifies each signature at most once", () => {
    const serverVerify = vi.spyOn(server, "verify");
    const clientVerify = vi.spyOn(client, "verify");
    verifyChallengeSignatures(signed(server, client), server, client);
    expect(serverVerify.mock.calls.length + clientVerify.mock.calls.length).toBe(2);
    serverVerify.mockRestore();
    clientVerify.mockRestore();
  });

  it(`rejects more than ${SEP10_MAX_CHALLENGE_SIGNATURES} signatures before any Ed25519 work`, () => {
    const serverVerify = vi.spyOn(server, "verify");
    const clientVerify = vi.spyOn(client, "verify");
    const tx = signed(server, client);
    for (let i = 0; i < 18; i++) tx.sign(StellarSdk.Keypair.random());

    expect(verifyChallengeSignatures(tx, server, client).code).toBe("UNRECOGNIZED_SIGNATURE");
    expect(serverVerify).not.toHaveBeenCalled();
    expect(clientVerify).not.toHaveBeenCalled();
    serverVerify.mockRestore();
    clientVerify.mockRestore();
  });

  it("skips Ed25519 verification for a signature whose hint matches neither signer", () => {
    const serverVerify = vi.spyOn(server, "verify");
    const clientVerify = vi.spyOn(client, "verify");
    const tx = signed(server);
    tx.sign(StellarSdk.Keypair.random());

    expect(verifyChallengeSignatures(tx, server, client).code).toBe("CLIENT_SIGNATURE_INVALID");
    // Only the real server signature was verified; the stranger's was hint-filtered.
    expect(serverVerify).toHaveBeenCalledTimes(1);
    expect(clientVerify).not.toHaveBeenCalled();
    serverVerify.mockRestore();
    clientVerify.mockRestore();
  });

  it("rejects a forged server signature that carries the right hint", () => {
    const tx = signed(client);
    tx.signatures.push(forgedSignatureFor(server));
    expect(verifyChallengeSignatures(tx, server, client).code).toBe("SERVER_SIGNATURE_MISSING");
  });

  it("rejects a forged client signature that carries the right hint", () => {
    const tx = signed(server);
    tx.signatures.push(forgedSignatureFor(client));
    expect(verifyChallengeSignatures(tx, server, client).code).toBe("CLIENT_SIGNATURE_INVALID");
  });

  it("rejects a duplicated server signature in place of the client's", () => {
    const tx = signed(server);
    tx.signatures.push(tx.signatures[0]);
    expect(verifyChallengeSignatures(tx, server, client).code).toBe("CLIENT_SIGNATURE_INVALID");
  });

  it("rejects signatures over a different transaction (tampered challenge)", () => {
    const original = signed(server, client);
    const tampered = unsignedChallenge("b".repeat(48));
    tampered.signatures.push(...original.signatures);
    // Swapped nonce -> different tx hash, so neither signature verifies.
    expect(verifyChallengeSignatures(tampered, server, client).valid).toBe(false);
  });

  it("rejects a challenge with no signatures", () => {
    expect(verifyChallengeSignatures(unsignedChallenge(), server, client).code).toBe(
      "SERVER_SIGNATURE_MISSING",
    );
  });
});
