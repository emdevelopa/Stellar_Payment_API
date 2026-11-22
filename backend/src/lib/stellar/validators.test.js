import { beforeEach, describe, expect, it, vi } from "vitest";
import * as StellarSdk from "stellar-sdk";
import {
  amountsMatch,
  classifyAmount,
  classifyStrKey,
  clearDeadLetterQueue,
  crc16XModem,
  decodeBase32,
  decodeStrKey,
  enqueueValidationDeadLetter,
  formatValidationError,
  getDeadLetterQueueStats,
  isValidAssetCode,
  isValidContractId,
  isValidEd25519Signature,
  isValidFederatedAddress,
  isValidLedgerKey,
  isValidMed25519PublicKey,
  isValidMuxedAccount,
  isValidPreAuthTx,
  isValidSecretSeed,
  isValidSha256Hash,
  isValidSignedPayload,
  isValidStellarAccountId,
  isValidStellarPublicKey,
  isValidTransactionHash,
  recoverDeadLetterQueue,
  recoverValidatorDeadLetterQueue,
  resolveAsset,
  resolveFederatedAddress,
  resetValidatorMetrics,
  sanitizeFederatedAddress,
  sanitizePayload,
  sanitizeSignature,
  sanitizeStrKey,
  StellarValidationError,
  STRKEY_VERSION_BYTES,
  validateMemo,
  validatorDlq,
  validatorDlqDepth,
  validatorDlqOperationsTotal,
  validatorDuration,
  validatorEvaluationsTotal,
  validatorRegister,
  validatorRejectionsTotal,
  verifyEd25519Signature,
  ValidatorDeadLetterQueue,
} from "./validators.js";

describe("Stellar Account & Ledger Key Validator", () => {
  const sampleKeypair = StellarSdk.Keypair.random();
  const samplePublicKey = sampleKeypair.publicKey();
  const sampleSecret = sampleKeypair.secret();

  beforeEach(() => {
    clearDeadLetterQueue();
    resetValidatorMetrics();
    vi.clearAllMocks();
  });

  describe("Base32 & CRC16-XModem StrKey Codec", () => {
    it("correctly decodes Base32 and verifies CRC16 checksum", () => {
      const decoded = decodeStrKey(samplePublicKey);
      expect(decoded.type).toBe("ed25519PublicKey");
      expect(decoded.versionByte).toBe(STRKEY_VERSION_BYTES.ed25519PublicKey);
      expect(decoded.payload).toHaveLength(32);
      expect(decoded.checksum).toBeGreaterThan(0);
    });

    it("rejects corrupted StrKey checksums and malformed base32 strings", () => {
      const corruptedChecksum = `${samplePublicKey.slice(0, -2)}AA`;
      expect(() => decodeStrKey(corruptedChecksum)).toThrow(StellarValidationError);
      expect(() => decodeStrKey("")).toThrow("must be a non-empty string");
      expect(() => decodeStrKey("1890InvalidBase32!@#")).toThrow("Invalid Base32 encoding");
      expect(() => decodeStrKey(null)).toThrow(StellarValidationError);
    });

    it("handles Base32 decoding corner cases", () => {
      expect(decodeBase32(12345)).toBeNull();
      expect(decodeBase32("890890")).toBeNull(); // 8, 9, 0 not in base32 alphabet
      expect(crc16XModem(Buffer.from([]))).toBe(0);
    });
  });

  describe("StrKey Classification & Type Validation", () => {
    it("correctly classifies all supported Stellar StrKey types", () => {
      const contractId = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 1));
      const preAuthTx = StellarSdk.StrKey.encodePreAuthTx(Buffer.alloc(32, 2));
      const sha256Hash = StellarSdk.StrKey.encodeSha256Hash(Buffer.alloc(32, 3));
      const muxedAccount = StellarSdk.StrKey.encodeMed25519PublicKey(
        Buffer.concat([sampleKeypair.rawPublicKey(), Buffer.alloc(8, 0)])
      );

      expect(classifyStrKey(samplePublicKey)).toBe("ed25519_public_key");
      expect(classifyStrKey(sampleSecret)).toBe("secret_seed");
      expect(classifyStrKey(contractId)).toBe("contract");
      expect(classifyStrKey(preAuthTx)).toBe("pre_auth_tx");
      expect(classifyStrKey(sha256Hash)).toBe("sha256_hash");
      expect(classifyStrKey(muxedAccount)).toBe("muxed_account");
      expect(classifyStrKey("invalid-strkey")).toBe("invalid");
      expect(classifyStrKey(null)).toBe("invalid");
    });

    it("sanitizes StrKey values and enforces expected types", () => {
      const paddedKey = `  ${samplePublicKey}  `;
      expect(sanitizeStrKey(paddedKey)).toBe(samplePublicKey);

      expect(() => sanitizeStrKey(paddedKey, { expectedType: "contract" })).toThrow(
        /StrKey type mismatch/
      );
      expect(() => sanitizeStrKey(sampleSecret, { allowSecret: false })).toThrow(
        /Secret seeds are not permitted/
      );
      expect(sanitizeStrKey(sampleSecret, { allowSecret: true })).toBe(sampleSecret);
      expect(() => sanitizeStrKey(null)).toThrow("must be a string");
      expect(() => sanitizeStrKey(`${samplePublicKey}\u0000`)).toThrow(
        "contains illegal control characters"
      );
    });

    it("validates specific ledger key format checkers", () => {
      const contractId = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 1));
      const preAuthTx = StellarSdk.StrKey.encodePreAuthTx(Buffer.alloc(32, 2));
      const sha256Hash = StellarSdk.StrKey.encodeSha256Hash(Buffer.alloc(32, 3));
      const muxedAccount = StellarSdk.StrKey.encodeMed25519PublicKey(
        Buffer.concat([sampleKeypair.rawPublicKey(), Buffer.alloc(8, 0)])
      );

      expect(isValidContractId(contractId)).toBe(true);
      expect(isValidContractId(samplePublicKey)).toBe(false);
      expect(isValidContractId(123)).toBe(false);

      expect(isValidPreAuthTx(preAuthTx)).toBe(true);
      expect(isValidPreAuthTx(samplePublicKey)).toBe(false);
      expect(isValidPreAuthTx(null)).toBe(false);

      expect(isValidSha256Hash(sha256Hash)).toBe(true);
      expect(isValidSha256Hash(samplePublicKey)).toBe(false);
      expect(isValidSha256Hash({})).toBe(false);

      expect(isValidMuxedAccount(muxedAccount)).toBe(true);
      expect(isValidMed25519PublicKey(muxedAccount)).toBe(true);
      expect(isValidMuxedAccount(samplePublicKey)).toBe(false);
      expect(isValidMuxedAccount(null)).toBe(false);

      expect(isValidSecretSeed(sampleSecret)).toBe(true);
      expect(isValidSecretSeed(samplePublicKey)).toBe(false);
      expect(isValidSecretSeed(undefined)).toBe(false);
    });

    it("strictly rejects secret seeds in isValidLedgerKey", () => {
      expect(isValidLedgerKey(sampleSecret)).toBe(false);
      expect(isValidLedgerKey(samplePublicKey)).toBe(true);
      expect(isValidLedgerKey(samplePublicKey, "account")).toBe(true);
      expect(isValidLedgerKey(samplePublicKey, "contract")).toBe(false);
      expect(isValidLedgerKey(null)).toBe(false);

      const contractId = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 1));
      expect(isValidLedgerKey(contractId, "contract")).toBe(true);

      const preAuthTx = StellarSdk.StrKey.encodePreAuthTx(Buffer.alloc(32, 2));
      expect(isValidLedgerKey(preAuthTx, "pre_auth_tx")).toBe(true);

      const sha256Hash = StellarSdk.StrKey.encodeSha256Hash(Buffer.alloc(32, 3));
      expect(isValidLedgerKey(sha256Hash, "sha256_hash")).toBe(true);

      const muxedAccount = StellarSdk.StrKey.encodeMed25519PublicKey(
        Buffer.concat([sampleKeypair.rawPublicKey(), Buffer.alloc(8, 0)])
      );
      expect(isValidLedgerKey(muxedAccount, "muxed")).toBe(true);
      expect(isValidLedgerKey(muxedAccount, "unknown_type")).toBe(false);
    });
  });

  describe("Ed25519 Signature Validator", () => {
    const payload = Buffer.from("test payment transaction envelope");
    const validSignature = sampleKeypair.sign(payload);

    it("accepts valid 64-byte Buffer, Hex, and Base64 signatures", () => {
      const hexSignature = validSignature.toString("hex");
      const base64Signature = validSignature.toString("base64");

      expect(isValidEd25519Signature(validSignature)).toBe(true);
      expect(isValidEd25519Signature(hexSignature)).toBe(true);
      expect(isValidEd25519Signature(base64Signature)).toBe(true);
    });

    it("rejects malformed, truncated, or non-64-byte signatures", () => {
      expect(isValidEd25519Signature(Buffer.alloc(63))).toBe(false);
      expect(isValidEd25519Signature(Buffer.alloc(65))).toBe(false);
      expect(isValidEd25519Signature("a".repeat(127))).toBe(false);
      expect(isValidEd25519Signature("g".repeat(128))).toBe(false); // non-hex
      expect(isValidEd25519Signature(null)).toBe(false);
      expect(isValidEd25519Signature(12345)).toBe(false);
    });

    it("detects and rejects non-canonical malleable S-scalars (S >= L)", () => {
      // Create signature with S >= L
      const malleableSig = Buffer.alloc(64);
      malleableSig.fill(0x01, 0, 32); // R
      malleableSig.fill(0xff, 32, 64); // S (0xFFFFFF... > L)

      expect(isValidEd25519Signature(malleableSig)).toBe(false);
      expect(() => sanitizeSignature(malleableSig)).toThrow(
        /Invalid Ed25519 signature payload/
      );
    });

    it("sanitizes valid signatures and rejects invalid inputs", () => {
      const hexSignature = validSignature.toString("hex");
      const sanitized = sanitizeSignature(hexSignature);
      expect(Buffer.isBuffer(sanitized)).toBe(true);
      expect(sanitized).toHaveLength(64);
      expect(sanitized.equals(validSignature)).toBe(true);

      expect(() => sanitizeSignature(null)).toThrow("Signature is required");
      expect(() => sanitizeSignature("bad-sig")).toThrow(StellarValidationError);
    });

    it("cryptographically verifies authentic Ed25519 signatures", () => {
      const result = verifyEd25519Signature(samplePublicKey, payload, validSignature);
      expect(result).toEqual({ valid: true });

      // Verifies string data as well
      const stringResult = verifyEd25519Signature(
        samplePublicKey,
        "test payment transaction envelope",
        validSignature
      );
      expect(stringResult).toEqual({ valid: true });
    });

    it("rejects tampered signatures, corrupted payloads, and mismatched keys", () => {
      const corruptedSig = Buffer.from(validSignature);
      corruptedSig[0] ^= 0xff;

      const tamperedResult = verifyEd25519Signature(samplePublicKey, payload, corruptedSig);
      expect(tamperedResult.valid).toBe(false);
      expect(tamperedResult.reason).toContain("verification failed");

      const mismatchedKeypair = StellarSdk.Keypair.random();
      const wrongKeyResult = verifyEd25519Signature(
        mismatchedKeypair.publicKey(),
        payload,
        validSignature
      );
      expect(wrongKeyResult.valid).toBe(false);

      const invalidKeyResult = verifyEd25519Signature("GBAD_KEY", payload, validSignature);
      expect(invalidKeyResult.valid).toBe(false);
      expect(invalidKeyResult.reason).toBe("Invalid Stellar public key");

      const invalidDataResult = verifyEd25519Signature(samplePublicKey, null, validSignature);
      expect(invalidDataResult.valid).toBe(false);
      expect(invalidDataResult.reason).toContain("Data must be a non-empty string or buffer");
    });
  });

  describe("Federated Address Resolver & SSRF Defense", () => {
    it("validates legitimate federated address formats", () => {
      expect(isValidFederatedAddress("alice*example.com")).toBe(true);
      expect(isValidFederatedAddress("bob.smith_123*payments.stellar.org")).toBe(true);
      expect(isValidFederatedAddress("user-name+tag*merchant-service.co.uk")).toBe(true);
    });

    it("strictly blocks SSRF attacks and illegal network addresses", () => {
      // IPv4 and IPv6 literals
      expect(isValidFederatedAddress("user*127.0.0.1")).toBe(false);
      expect(isValidFederatedAddress("user*10.0.0.1")).toBe(false);
      expect(isValidFederatedAddress("user*192.168.1.1")).toBe(false);
      expect(isValidFederatedAddress("user*169.254.169.254")).toBe(false);
      expect(isValidFederatedAddress("user*[::1]")).toBe(false);
      expect(isValidFederatedAddress("user*::1")).toBe(false);

      // Localhost and internal reserved zones
      expect(isValidFederatedAddress("user*localhost")).toBe(false);
      expect(isValidFederatedAddress("user*admin.localhost")).toBe(false);
      expect(isValidFederatedAddress("user*corp.internal")).toBe(false);
      expect(isValidFederatedAddress("user*router.local")).toBe(false);
      expect(isValidFederatedAddress("user*hidden.onion")).toBe(false);
      expect(isValidFederatedAddress("user*service.test")).toBe(false);

      // Malformed inputs
      expect(isValidFederatedAddress("missing-asterisk.com")).toBe(false);
      expect(isValidFederatedAddress("alice*bob*example.com")).toBe(false);
      expect(isValidFederatedAddress("user*domain.com:8080")).toBe(false);
      expect(isValidFederatedAddress("user*https://example.com")).toBe(false);
      expect(isValidFederatedAddress(null)).toBe(false);
      expect(isValidFederatedAddress("a".repeat(300))).toBe(false);
    });

    it("sanitizes federated addresses and lowercases domains", () => {
      const sanitized = sanitizeFederatedAddress("  Alice*EXAMPLE.COM  ");
      expect(sanitized).toEqual({
        address: "Alice*example.com",
        username: "Alice",
        domain: "example.com",
      });

      expect(() => sanitizeFederatedAddress("invalid-addr")).toThrow(
        /Invalid federated address/
      );
    });

    it("resolves federated address with mock federation server", async () => {
      const mockToml = `
        FEDERATION_SERVER = "https://fed.example.com/federation"
      `;
      const mockFedResponse = {
        account_id: samplePublicKey,
        memo_type: "text",
        memo: "payment-ref-123",
      };

      const mockFetch = vi.fn().mockImplementation((url) => {
        if (url.includes(".well-known/stellar.toml")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => mockToml,
          });
        }
        if (url.includes("fed.example.com/federation")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => mockFedResponse,
          });
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      const result = await resolveFederatedAddress("alice*example.com", {
        fetchFn: mockFetch,
        timeoutMs: 1000,
      });

      expect(result).toEqual({
        account_id: samplePublicKey,
        memo_type: "text",
        memo: "payment-ref-123",
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("rejects federation responses with invalid account IDs or bad memos", async () => {
      const mockToml = 'FEDERATION_SERVER = "https://fed.example.com/federation"';
      const badFedResponse = {
        account_id: "G_INVALID_ACCOUNT_ID",
      };

      const mockFetch = vi.fn().mockImplementation((url) => {
        if (url.includes(".well-known/stellar.toml")) {
          return Promise.resolve({ ok: true, status: 200, text: async () => mockToml });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => badFedResponse });
      });

      await expect(
        resolveFederatedAddress("alice*example.com", { fetchFn: mockFetch })
      ).rejects.toThrow("Federation response contains invalid account_id");
    });

    it("blocks insecure or internal FEDERATION_SERVER endpoints (SSRF)", async () => {
      const insecureToml = 'FEDERATION_SERVER = "http://insecure.example.com/fed"';
      const mockFetchInsecure = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => insecureToml,
      });

      await expect(
        resolveFederatedAddress("alice*example.com", { fetchFn: mockFetchInsecure })
      ).rejects.toThrow("FEDERATION_SERVER must use HTTPS");

      const ssrfToml = 'FEDERATION_SERVER = "https://169.254.169.254/fed"';
      const mockFetchSsrf = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => ssrfToml,
      });

      await expect(
        resolveFederatedAddress("alice*example.com", { fetchFn: mockFetchSsrf })
      ).rejects.toThrow("FEDERATION_SERVER targets disallowed host");
    });

    it("retries transient failures and enqueues to DLQ when retries are exhausted", async () => {
      const customDlq = new ValidatorDeadLetterQueue();
      const mockFailingFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });

      await expect(
        resolveFederatedAddress("alice*example.com", {
          fetchFn: mockFailingFetch,
          maxRetries: 2,
          retryDelayMs: 10,
          dlq: customDlq,
        })
      ).rejects.toThrow("HTTP 503");

      expect(mockFailingFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(customDlq.size).toBe(1);
      const dlqEntry = customDlq.shift();
      expect(dlqEntry.item.address).toBe("alice*example.com");
      expect(dlqEntry.attempts).toBe(2);
    });
  });

  describe("Payload Sanitization & Anti-Tampering", () => {
    it("drops prototype pollution attempts (__proto__, constructor, prototype)", () => {
      const poisoned = JSON.parse(
        '{"validKey": "validVal", "__proto__": {"polluted": true}, "constructor": {"polluted": true}}'
      );

      const sanitized = sanitizePayload(poisoned);
      expect(sanitized.validKey).toBe("validVal");
      expect(sanitized.polluted).toBeUndefined();
      expect(Object.prototype.polluted).toBeUndefined();
      expect(sanitized.__proto__).toBeUndefined();
      expect(sanitized.constructor).toBeUndefined();
    });

    it("strips null bytes and control characters while normalizing Unicode", () => {
      const maliciousInput = {
        name: "User\u0000Name\u0007\u0008",
        message: "Hello\r\nWorld\tText",
        unicode: "Caf\u00e9",
      };

      const sanitized = sanitizePayload(maliciousInput);
      expect(sanitized.name).toBe("UserName");
      expect(sanitized.message).toBe("Hello\r\nWorld\tText");
      expect(sanitized.unicode).toBe("Café");
    });

    it("detects circular references and recursion attacks", () => {
      const circular = { key: "value" };
      circular.self = circular;

      expect(() => sanitizePayload(circular)).toThrow(/Circular reference detected/);
    });

    it("enforces schema allow-listing and required fields", () => {
      const schema = {
        amount: { required: true },
        recipient: { required: true },
      };

      const payload = {
        amount: "100.00",
        recipient: samplePublicKey,
        extraInjectedField: "attack_payload",
      };

      const sanitized = sanitizePayload(payload, schema);
      expect(sanitized.amount).toBe("100.00");
      expect(sanitized.recipient).toBe(samplePublicKey);
      expect(sanitized.extraInjectedField).toBeUndefined();

      expect(() => sanitizePayload({ amount: "50" }, schema)).toThrow(
        /Missing required payload field: recipient/
      );
    });
  });

  describe("Dead-Letter Queue (DLQ) & Automated Recovery", () => {
    it("enqueues failed tasks into DLQ and updates metrics", () => {
      const queue = new ValidatorDeadLetterQueue({ maxCapacity: 5 });
      expect(queue.size).toBe(0);

      const entry = queue.push(
        { operation: "resolve", address: "bob*example.com" },
        new Error("Network timeout"),
        1
      );

      expect(entry.id).toBeDefined();
      expect(entry.status).toBe("pending");
      expect(entry.attempts).toBe(1);
      expect(queue.size).toBe(1);
      expect(queue.stats).toEqual({ total: 1, pending: 1, exhausted: 0 });
    });

    it("enforces capacity limit and evicts oldest items gracefully", () => {
      const queue = new ValidatorDeadLetterQueue({ maxCapacity: 2 });
      queue.push({ id: 1 }, new Error("e1"));
      queue.push({ id: 2 }, new Error("e2"));
      expect(queue.size).toBe(2);

      queue.push({ id: 3 }, new Error("e3"));
      expect(queue.size).toBe(2);
      expect(queue.getAll()[0].item.id).toBe(2);
      expect(queue.getAll()[1].item.id).toBe(3);
    });

    it("recovers eligible items when recovery handler succeeds", async () => {
      const queue = new ValidatorDeadLetterQueue();
      const entry = queue.push({ key: "test" }, new Error("transient error"));
      entry.nextRetryAt = Date.now() - 1000; // Force eligible for retry

      const recoveryHandler = vi.fn().mockResolvedValue(true);
      const result = await recoverDeadLetterQueue({
        dlq: queue,
        handler: recoveryHandler,
      });

      expect(result.recovered).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.exhausted).toBe(0);
      expect(recoveryHandler).toHaveBeenCalledWith(entry);
      expect(queue.size).toBe(0);
    });

    it("applies exponential backoff on retry failure and marks poison pills as exhausted", async () => {
      const queue = new ValidatorDeadLetterQueue();
      const entry = queue.push({ key: "poison_pill" }, new Error("persistent error"), 2);
      entry.nextRetryAt = Date.now() - 1000;

      const failingHandler = vi.fn().mockRejectedValue(new Error("Still failing"));

      // 3rd attempt exceeds maxDlqRetries=3 -> marks as exhausted poison pill
      const result = await recoverDeadLetterQueue({
        dlq: queue,
        handler: failingHandler,
        maxDlqRetries: 3,
      });

      expect(result.exhausted).toBe(1);
      expect(result.recovered).toBe(0);
      expect(entry.status).toBe("exhausted");
      expect(queue.stats.exhausted).toBe(1);
      expect(queue.getExhausted()).toHaveLength(1);
    });

    it("uses default validator DLQ helpers and clear functionality", async () => {
      expect(getDeadLetterQueueStats().total).toBe(0);

      enqueueValidationDeadLetter({ test: 1 }, new Error("err"));
      expect(getDeadLetterQueueStats().total).toBe(1);

      const entry = validatorDlq.peek();
      entry.nextRetryAt = Date.now() - 500;

      const result = await recoverValidatorDeadLetterQueue({
        handler: async () => true,
      });
      expect(result.recovered).toBe(1);
      expect(getDeadLetterQueueStats().total).toBe(0);

      enqueueValidationDeadLetter({ test: 2 }, new Error("err2"));
      clearDeadLetterQueue();
      expect(getDeadLetterQueueStats().total).toBe(0);
    });
  });

  describe("Error Formatting & Redaction", () => {
    it("redacts secret seeds from error messages", () => {
      const secret = sampleKeypair.secret();
      const error = new StellarValidationError(`Failed validation for seed: ${secret}`);
      const formatted = formatValidationError(error);

      expect(formatted.error).not.toContain(secret);
      expect(formatted.error).toContain("[REDACTED_SEED]");
    });
  });

  describe("Prometheus Metrics Instrumentation", () => {
    it("records validator evaluation and duration metrics", async () => {
      isValidStellarPublicKey(samplePublicKey);
      isValidStellarPublicKey("INVALID_KEY");

      const metric = await validatorEvaluationsTotal.get();
      const validEntry = metric.values.find(
        (v) => v.labels.operation === "public_key" && v.labels.outcome === "valid"
      );
      const invalidEntry = metric.values.find(
        (v) => v.labels.operation === "public_key" && v.labels.outcome === "invalid"
      );

      expect(validEntry.value).toBe(1);
      expect(invalidEntry.value).toBe(1);
    });
  });
});
