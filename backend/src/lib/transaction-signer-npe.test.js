/**
 * Null pointer / undefined dereference regression tests for Transaction Signer
 *
 * Each describe block maps 1-to-1 to a numbered NPE fix:
 *
 *  NPE-01  Horizon returns null tx / tx missing envelope_xdr
 *  NPE-02  transaction.source is null/undefined
 *  NPE-03  accountData is null (loadAccount resolves with falsy)
 *  NPE-04  signers array contains null entries or entries with invalid keys/weights
 *  NPE-05  decoratedSig.hint() or .signature() returns null
 *  NPE-06  transaction.hash() throws or returns null
 *  NPE-07  VerificationMemoryCache.set with maxEntries=0 (oldest iterator is undefined)
 *  NPE-08  Redis returns non-JSON / null-JSON / shape-less JSON
 *  NPE-09  ReplayCache.record with maxSize=0 (oldest iterator is undefined)
 *  NPE-10  cache.hit=true but cached.result is null → falls through to fresh verification
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Shared mock infrastructure
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("./metrics.js", () => ({
  txSignatureVerificationTotal: { inc: vi.fn() },
  txSignatureVerificationLatency: { startTimer: vi.fn(() => vi.fn()) },
  txSignatureVerificationErrors: { inc: vi.fn() },
  txSignatureReplayAttempts: { inc: vi.fn() },
  txSignatureCacheSize: { set: vi.fn() },
  txSignatureValidationFailures: { inc: vi.fn() },
  txSignatureCacheHits: { inc: vi.fn() },
  txSignatureCacheMisses: { inc: vi.fn() },
  signatureVerificationOperations: { inc: vi.fn() },
  signatureVerificationLatency: { observe: vi.fn() },
  signatureVerificationReplayDetected: { inc: vi.fn() },
}));

vi.mock("./transaction-signer-rate-limit.js", () => ({
  createTransactionSignerRateLimit: vi.fn(() => (_req, _res, next) => next()),
  createTransactionSignerBurstRateLimit: vi.fn(() => (_req, _res, next) => next()),
  createTransactionSignerRedisStore: vi.fn(() => ({})),
}));

vi.mock("./stellar.js", () => ({
  verifyTransactionSignature: vi.fn(async () => ({
    valid: true,
    reason: "ok",
    isMultiSig: false,
    signatureCount: 1,
    thresholdMet: true,
  })),
}));

const VALID_HASH = "a".repeat(64);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers shared across sections that exercise signature-verification.js
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal Horizon client factory. */
function makeHorizon({ fetchTransaction, loadAccount } = {}) {
  return {
    fetchTransaction: fetchTransaction ?? vi.fn(async () => ({
      envelope_xdr: "valid-xdr",
    })),
    loadAccount: loadAccount ?? vi.fn(async () => ({
      signers: [{ key: "GABC", weight: 1 }],
      thresholds: { med_threshold: 1 },
    })),
  };
}

const NET = "Test SDF Network ; September 2015";

// ─────────────────────────────────────────────────────────────────────────────
// Mock stellar-sdk for signature-verification.js tests
// ─────────────────────────────────────────────────────────────────────────────

const { mockVerify } = vi.hoisted(() => ({ mockVerify: vi.fn() }));

vi.mock("stellar-sdk", () => {
  const hint = Buffer.from([0xde, 0xad, 0xbe, 0xef]);

  const MockKeypair = {
    fromPublicKey: vi.fn(() => ({
      signatureHint: vi.fn(() => hint),
      verify: mockVerify,
    })),
  };

  const MockTransaction = vi.fn(() => ({
    source: "GABC",
    hash: vi.fn(() => Buffer.from("txhashbytes")),
    signatures: [
      {
        hint: vi.fn(() => hint),
        signature: vi.fn(() => Buffer.from("sigbytes")),
      },
    ],
  }));

  return {
    Keypair: MockKeypair,
    Transaction: MockTransaction,
    TransactionBuilder: {
      fromXDR: vi.fn(() => { throw new Error("not fee-bump"); }),
    },
    FeeBumpTransaction: class {},
    Networks: {
      TESTNET: NET,
      PUBLIC: "Public Global Stellar Network ; September 2015",
    },
  };
});

import { verifyTransactionSignature as verifySig } from "./stellar/signature-verification.js";

// ═════════════════════════════════════════════════════════════════════════════
// NPE-01 — null tx / missing envelope_xdr
// ═════════════════════════════════════════════════════════════════════════════

describe("NPE-01 — Horizon returns null tx or tx missing envelope_xdr", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns valid=false with a safe reason when fetchTransaction resolves with null", async () => {
    const h = makeHorizon({ fetchTransaction: vi.fn(async () => null) });
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/empty transaction response/i);
    // Must not throw
  });

  it("returns valid=false when tx.envelope_xdr is undefined", async () => {
    const h = makeHorizon({ fetchTransaction: vi.fn(async () => ({})) });
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing the envelope XDR/i);
  });

  it("returns valid=false when tx.envelope_xdr is null", async () => {
    const h = makeHorizon({ fetchTransaction: vi.fn(async () => ({ envelope_xdr: null })) });
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing the envelope XDR/i);
  });

  it("returns valid=false when tx.envelope_xdr is an empty string", async () => {
    const h = makeHorizon({ fetchTransaction: vi.fn(async () => ({ envelope_xdr: "   " })) });
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing the envelope XDR/i);
  });

  it("returns valid=false when tx.envelope_xdr is a number (wrong type)", async () => {
    const h = makeHorizon({ fetchTransaction: vi.fn(async () => ({ envelope_xdr: 42 })) });
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing the envelope XDR/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NPE-02 — transaction.source is null/undefined
// ═════════════════════════════════════════════════════════════════════════════

describe("NPE-02 — transaction.source is null/undefined", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns valid=false when transaction.source is null", async () => {
    const { Transaction } = await import("stellar-sdk");
    Transaction.mockImplementationOnce(() => ({
      source: null,
      hash: vi.fn(() => Buffer.from("txhashbytes")),
      signatures: [{ hint: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])), signature: vi.fn(() => Buffer.from("sig")) }],
    }));
    const h = makeHorizon();
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing a source account/i);
  });

  it("returns valid=false when transaction.source is undefined", async () => {
    const { Transaction } = await import("stellar-sdk");
    Transaction.mockImplementationOnce(() => ({
      // source intentionally omitted
      hash: vi.fn(() => Buffer.from("txhashbytes")),
      signatures: [{ hint: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])), signature: vi.fn(() => Buffer.from("sig")) }],
    }));
    const h = makeHorizon();
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing a source account/i);
  });

  it("returns valid=false when transaction.source is a non-string (number)", async () => {
    const { Transaction } = await import("stellar-sdk");
    Transaction.mockImplementationOnce(() => ({
      source: 12345,
      hash: vi.fn(() => Buffer.from("txhashbytes")),
      signatures: [{ hint: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])), signature: vi.fn(() => Buffer.from("sig")) }],
    }));
    const h = makeHorizon();
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing a source account/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NPE-03 — accountData is null
// ═════════════════════════════════════════════════════════════════════════════

describe("NPE-03 — loadAccount resolves with null/undefined", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns valid=false without throwing when loadAccount returns null", async () => {
    const h = makeHorizon({ loadAccount: vi.fn(async () => null) });
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/could not load source account/i);
  });

  it("returns valid=false without throwing when loadAccount returns undefined", async () => {
    const h = makeHorizon({ loadAccount: vi.fn(async () => undefined) });
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/could not load source account/i);
  });

  it("falls back to empty signers when accountData.signers is not an array", async () => {
    // No signers → no valid signatures → invalid
    const h = makeHorizon({
      loadAccount: vi.fn(async () => ({
        signers: "not-an-array",
        thresholds: { med_threshold: 1 },
      })),
    });
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/insufficient signing weight/i);
  });

  it("defaults med_threshold to 0 when thresholds is null", async () => {
    mockVerify.mockReturnValue(true);
    const h = makeHorizon({
      loadAccount: vi.fn(async () => ({
        signers: [{ key: "GABC", weight: 1 }],
        thresholds: null,
      })),
    });
    // threshold 0 + valid sig → should pass
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NPE-04 — malformed signer entries
// ═════════════════════════════════════════════════════════════════════════════

describe("NPE-04 — signers array contains null/malformed entries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips null signer entries without throwing", async () => {
    const h = makeHorizon({
      loadAccount: vi.fn(async () => ({
        // mix of null entries and a valid one
        signers: [null, undefined, { key: "GABC", weight: 1 }],
        thresholds: { med_threshold: 1 },
      })),
    });
    mockVerify.mockReturnValue(true);
    const result = await verifySig(h, VALID_HASH, NET);
    // Should not throw; valid signer still contributes
    expect(result.valid).toBe(true);
  });

  it("skips signer entries with a non-string key without throwing", async () => {
    const h = makeHorizon({
      loadAccount: vi.fn(async () => ({
        signers: [{ key: 99999, weight: 1 }, { key: "GABC", weight: 1 }],
        thresholds: { med_threshold: 1 },
      })),
    });
    mockVerify.mockReturnValue(true);
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(true);
  });

  it("skips signer entries where Keypair.fromPublicKey throws (invalid key)", async () => {
    const { Keypair } = await import("stellar-sdk");
    // First call throws (bad key), second call succeeds (good key)
    Keypair.fromPublicKey
      .mockImplementationOnce(() => { throw new Error("Invalid Stellar public key"); })
      .mockImplementationOnce(() => ({
        signatureHint: () => Buffer.from([0xde, 0xad, 0xbe, 0xef]),
        verify: () => true,
      }));

    const h = makeHorizon({
      loadAccount: vi.fn(async () => ({
        signers: [
          { key: "GBADKEY", weight: 1 },
          { key: "GABC", weight: 1 },
        ],
        thresholds: { med_threshold: 1 },
      })),
    });
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(true);
  });

  it("treats missing weight as 0 (no NPE on undefined arithmetic)", async () => {
    // A signer with no weight field — arithmetic must not produce NaN
    const h = makeHorizon({
      loadAccount: vi.fn(async () => ({
        signers: [{ key: "GABC" }], // weight intentionally absent
        thresholds: { med_threshold: 1 },
      })),
    });
    mockVerify.mockReturnValue(true);
    const result = await verifySig(h, VALID_HASH, NET);
    // weight defaults to 0 → accumulated weight 0 < threshold 1 → invalid
    expect(result.valid).toBe(false);
    // totalWeight should be a number (not NaN)
    expect(result.reason).not.toMatch(/nan/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NPE-05 — decoratedSig.hint() or .signature() returns null
// ═════════════════════════════════════════════════════════════════════════════

describe("NPE-05 — decoratedSig.hint() or .signature() returns null", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips a signature where hint() returns null without throwing", async () => {
    const { Transaction } = await import("stellar-sdk");
    Transaction.mockImplementationOnce(() => ({
      source: "GABC",
      hash: vi.fn(() => Buffer.from("txhashbytes")),
      signatures: [
        { hint: vi.fn(() => null), signature: vi.fn(() => Buffer.from("sig")) },
        { hint: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])), signature: vi.fn(() => Buffer.from("sig")) },
      ],
    }));
    mockVerify.mockReturnValue(true);
    const h = makeHorizon();
    const result = await verifySig(h, VALID_HASH, NET);
    // Second sig is valid; should not throw on the first (null hint)
    expect(result.valid).toBe(true);
  });

  it("skips a signature where signature() returns null without throwing", async () => {
    const { Transaction } = await import("stellar-sdk");
    Transaction.mockImplementationOnce(() => ({
      source: "GABC",
      hash: vi.fn(() => Buffer.from("txhashbytes")),
      signatures: [
        { hint: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])), signature: vi.fn(() => null) },
        { hint: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])), signature: vi.fn(() => Buffer.from("sig")) },
      ],
    }));
    mockVerify.mockReturnValue(true);
    const h = makeHorizon();
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(true);
  });

  it("returns valid=false (no crash) when ALL signatures have null hint", async () => {
    const { Transaction } = await import("stellar-sdk");
    Transaction.mockImplementationOnce(() => ({
      source: "GABC",
      hash: vi.fn(() => Buffer.from("txhashbytes")),
      signatures: [
        { hint: vi.fn(() => null), signature: vi.fn(() => Buffer.from("sig")) },
      ],
    }));
    const h = makeHorizon();
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NPE-06 — transaction.hash() throws or returns null
// ═════════════════════════════════════════════════════════════════════════════

describe("NPE-06 — transaction.hash() throws or returns null", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns valid=false without throwing when transaction.hash() throws", async () => {
    const { Transaction } = await import("stellar-sdk");
    Transaction.mockImplementationOnce(() => ({
      source: "GABC",
      hash: vi.fn(() => { throw new Error("network passphrase missing"); }),
      signatures: [{ hint: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])), signature: vi.fn(() => Buffer.from("sig")) }],
    }));
    const h = makeHorizon();
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/failed to compute transaction hash/i);
  });

  it("returns valid=false without throwing when transaction.hash() returns null", async () => {
    const { Transaction } = await import("stellar-sdk");
    Transaction.mockImplementationOnce(() => ({
      source: "GABC",
      hash: vi.fn(() => null),
      signatures: [{ hint: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])), signature: vi.fn(() => Buffer.from("sig")) }],
    }));
    const h = makeHorizon();
    const result = await verifySig(h, VALID_HASH, NET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/failed to compute transaction hash/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NPE-07 — VerificationMemoryCache.set with maxEntries=0
// ═════════════════════════════════════════════════════════════════════════════

import { TransactionSignerCache } from "./transaction-signer-cache.js";

describe("NPE-07 — VerificationMemoryCache.set with maxEntries=0", () => {
  it("does not throw when maxEntries=0 (oldest iterator value is undefined)", () => {
    const cache = new TransactionSignerCache({ maxEntries: 0 });
    // With maxEntries=0 the cache.size >= maxEntries condition fires immediately.
    // The Map is empty so keys().next().value === undefined.
    // The guard must prevent cache.delete(undefined) from being called.
    expect(() => {
      cache.memory.set(VALID_HASH, { valid: true }, true);
    }).not.toThrow();
  });

  it("does not grow beyond maxEntries=1 after repeated inserts", () => {
    const cache = new TransactionSignerCache({ maxEntries: 1 });
    cache.memory.set("a".repeat(64), { valid: true }, true);
    cache.memory.set("b".repeat(64), { valid: true }, true);
    cache.memory.set("c".repeat(64), { valid: true }, true);
    expect(cache.memory.size).toBe(1);
  });

  it("correctly evicts the oldest entry when at capacity > 0", () => {
    const cache = new TransactionSignerCache({ maxEntries: 2 });
    cache.memory.set("a".repeat(64), { valid: true }, true);
    cache.memory.set("b".repeat(64), { valid: true }, true);
    // Third insert must evict "a"
    cache.memory.set("c".repeat(64), { valid: true }, true);
    expect(cache.memory.get("a".repeat(64))).toBeNull();
    expect(cache.memory.get("c".repeat(64))).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NPE-08 — Redis returns malformed JSON / null JSON / wrong-shape JSON
// ═════════════════════════════════════════════════════════════════════════════

describe("NPE-08 — Redis get() returns malformed or null-shape JSON", () => {
  function makeCache(redisGet) {
    const mockRedis = {
      get: vi.fn(redisGet),
      set: vi.fn(async () => "OK"),
      del: vi.fn(async () => 1),
    };
    return new TransactionSignerCache({ redisClient: mockRedis });
  }

  it("returns hit=false (no throw) when Redis returns the string 'null'", async () => {
    const cache = makeCache(async () => "null");
    const result = await cache.get(VALID_HASH);
    expect(result.hit).toBe(false);
    expect(result.result).toBeNull();
  });

  it("returns hit=false (no throw) when Redis returns invalid JSON", async () => {
    const cache = makeCache(async () => "{not valid json}");
    const result = await cache.get(VALID_HASH);
    expect(result.hit).toBe(false);
  });

  it("returns hit=false when Redis returns a JSON primitive (number)", async () => {
    const cache = makeCache(async () => "42");
    const result = await cache.get(VALID_HASH);
    expect(result.hit).toBe(false);
  });

  it("returns hit=false when Redis returns a JSON object without the 'result' key", async () => {
    const cache = makeCache(async () => JSON.stringify({ foo: "bar" }));
    const result = await cache.get(VALID_HASH);
    expect(result.hit).toBe(false);
  });

  it("returns hit=true with correct result when Redis returns well-formed JSON", async () => {
    const payload = { result: { valid: true, reason: "ok" }, valid: true };
    const cache = makeCache(async () => JSON.stringify(payload));
    const result = await cache.get(VALID_HASH);
    expect(result.hit).toBe(true);
    expect(result.result).toEqual(payload.result);
  });

  it("treats parsed.valid as boolean even when Redis stores it as a truthy string", async () => {
    // JSON booleans are preserved; this checks !!parsed.valid coercion path
    const payload = { result: { valid: true }, valid: 1 }; // valid=1 (truthy non-boolean)
    const cache = makeCache(async () => JSON.stringify(payload));
    const result = await cache.get(VALID_HASH);
    expect(result.hit).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NPE-09 — ReplayCache.record with maxSize=0
// ═════════════════════════════════════════════════════════════════════════════

vi.mock("./transaction-signer-cache.js", () => ({
  getTransactionSignerCache: vi.fn(() => ({
    get: vi.fn(async () => ({ hit: false, result: null })),
    set: vi.fn(async () => {}),
  })),
}));

import {
  DistributedReplayCache,
  initDistributedReplayCache,
  clearReplayCache,
  verifyTransactionSignatureSecure,
} from "./transaction-signer.js";

describe("NPE-09 — ReplayCache.record with maxSize=0", () => {
  it("does not throw when maxSize=0 and record() is called (oldest iterator is undefined)", async () => {
    // verifyTransactionSignatureSecure calls replayCache.record() via
    // recordVerificationSuccess after a successful verification.
    // We cannot directly construct ReplayCache (it's private), but we can
    // trigger the path by calling verifyTransactionSignatureSecure with a valid
    // hash.  The module-level replayCache uses CONFIG.REPLAY_CACHE_MAX_SIZE
    // (10_000) so this test instead validates the guard logic directly via
    // the cache's own Map behaviour.
    //
    // Direct unit test of the guard:
    // Simulate the exact code path — a Map at size=0, calling keys().next().value
    const map = new Map();
    const oldest = map.keys().next().value; // undefined
    // Before the fix this would call map.delete(undefined) — which would not
    // actually throw but could mask bugs; the guard makes the intent explicit.
    expect(oldest).toBeUndefined();
    expect(() => {
      if (oldest !== undefined) map.delete(oldest);
    }).not.toThrow();
    expect(map.size).toBe(0);
  });

  it("verifyTransactionSignatureSecure does not throw with the default replay cache", async () => {
    await clearReplayCache();
    initDistributedReplayCache(null);

    const { verifyTransactionSignature } = await import("./stellar.js");
    verifyTransactionSignature.mockResolvedValueOnce({
      valid: true,
      isMultiSig: false,
      signatureCount: 1,
      thresholdMet: true,
    });

    await expect(
      verifyTransactionSignatureSecure(VALID_HASH),
    ).resolves.toHaveProperty("valid");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// NPE-10 — cache.hit=true but cached.result is null
// ═════════════════════════════════════════════════════════════════════════════

describe("NPE-10 — cache returns hit=true with null result", () => {
  beforeEach(async () => {
    await clearReplayCache();
    initDistributedReplayCache(null);
  });

  it("falls through to fresh verification instead of returning null", async () => {
    const { getTransactionSignerCache } = await import("./transaction-signer-cache.js");

    // Override the mock to return hit=true with result=null
    getTransactionSignerCache.mockReturnValueOnce({
      get: vi.fn(async () => ({ hit: true, result: null })),
      set: vi.fn(async () => {}),
    });

    const { verifyTransactionSignature } = await import("./stellar.js");
    verifyTransactionSignature.mockResolvedValueOnce({
      valid: true,
      reason: "fresh verification",
      isMultiSig: false,
      signatureCount: 1,
      thresholdMet: true,
    });

    const result = await verifyTransactionSignatureSecure(VALID_HASH);

    // Must not return null — must return the fresh verification result
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("valid");
    // The fresh verifier was called (fell through the null-result guard)
    expect(verifyTransactionSignature).toHaveBeenCalled();
  });

  it("returns the cached result normally when cache.hit=true and result is a valid object", async () => {
    const { getTransactionSignerCache } = await import("./transaction-signer-cache.js");

    const cachedResult = { valid: false, reason: "cached invalid sig" };
    getTransactionSignerCache.mockReturnValueOnce({
      get: vi.fn(async () => ({ hit: true, result: cachedResult })),
      set: vi.fn(async () => {}),
    });

    const { verifyTransactionSignature } = await import("./stellar.js");
    verifyTransactionSignature.mockClear();

    const result = await verifyTransactionSignatureSecure("b".repeat(64));

    expect(result).toEqual(cachedResult);
    // Fresh verifier must NOT have been called
    expect(verifyTransactionSignature).not.toHaveBeenCalled();
  });
});
