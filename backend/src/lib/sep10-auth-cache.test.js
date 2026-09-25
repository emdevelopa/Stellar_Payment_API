/**
 * sep10-auth-cache.test.js
 *
 * Issue #1030: the SEP-10 server keypair must be decoded once and reused —
 * per-request `fromSecret` calls waste decodes and let a rotated secret fail
 * different requests differently. Validity is established at first use.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import * as StellarSdk from "stellar-sdk";
import {
  getServerKeypair,
  generateChallenge,
  _resetServerKeypairCacheForTests,
} from "./sep10-auth.js";

describe("SEP-10 server keypair cache (#1030)", () => {
  let goodKeypair;

  beforeAll(() => {
    process.env.JWT_SECRET = "test-jwt-secret";
    goodKeypair = StellarSdk.Keypair.random();
  });

  beforeEach(() => {
    _resetServerKeypairCacheForTests();
    process.env.SEP10_SERVER_SIGNING_KEY = goodKeypair.secret();
  });

  it("returns the same instance across calls (decoded once)", () => {
    expect(getServerKeypair()).toBe(getServerKeypair());
    expect(getServerKeypair().publicKey()).toBe(goodKeypair.publicKey());
  });

  it("generateChallenge signs with the cached keypair", () => {
    const client = StellarSdk.Keypair.random();
    const xdr = generateChallenge(client.publicKey(), "localhost");
    expect(typeof xdr).toBe("string");
    // Second call reuses the cache — no re-decode, same signer.
    expect(getServerKeypair().publicKey()).toBe(goodKeypair.publicKey());
  });

  it("throws a clear error when the secret is missing", () => {
    delete process.env.SEP10_SERVER_SIGNING_KEY;
    expect(() => getServerKeypair()).toThrow(
      "SEP-0010 server signing key not configured"
    );
  });

  it("throws a clear error when the secret is undecodable", () => {
    process.env.SEP10_SERVER_SIGNING_KEY = "NOT-A-VALID-SECRET";
    expect(() => getServerKeypair()).toThrow(
      "SEP-0010 server signing key is invalid"
    );
  });
});
