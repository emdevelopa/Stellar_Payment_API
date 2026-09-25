import express from "express";
import request from "supertest";
import * as StellarSdk from "stellar-sdk";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockMaybeSingle, mockFrom, mockLogLoginAttempt } = vi.hoisted(() => ({
  mockMaybeSingle: vi.fn(),
  mockFrom: vi.fn(),
  mockLogLoginAttempt: vi.fn(),
}));

vi.mock("../lib/supabase.js", () => ({
  supabase: {
    from: mockFrom,
  },
}));

vi.mock("../lib/audit.js", () => ({
  logLoginAttempt: mockLogLoginAttempt,
}));

vi.mock("../lib/auth.js", () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("../lib/validation.js", () => ({
  validateRequest: () => (_req, _res, next) => next(),
}));

vi.mock("../lib/request-schemas.js", () => ({
  authChallengeSchema: {},
  authVerifySchema: {},
}));

import createAuthRouter from "./auth.js";
import {
  createSep10ChallengeRateLimit,
  createSep10VerifyRateLimit,
  getSep10ChallengeRateLimitKey,
  getSep10VerifyRateLimitKey,
} from "../lib/rate-limit.js";
import { _resetNonceCacheForTests } from "../lib/sep10-auth.js";

function createApp(router) {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

describe("SEP-10 auth routes", () => {
  let clientKeypair;
  let serverKeypair;

  beforeAll(() => {
    process.env.JWT_SECRET = "test-jwt-secret";
    process.env.HOME_DOMAIN = "localhost";
    clientKeypair = StellarSdk.Keypair.random();
    serverKeypair = StellarSdk.Keypair.random();
    process.env.SEP10_SERVER_SIGNING_KEY = serverKeypair.secret();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    _resetNonceCacheForTests();
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: mockMaybeSingle,
            }),
          }),
        }),
      }),
    });
  });

  it("builds challenge rate-limit keys from account and IP", () => {
    const key = getSep10ChallengeRateLimitKey({
      body: { account: "GABC123" },
      ip: "203.0.113.10",
    });
    expect(key).toContain("sep10:challenge:GABC123:");
  });

  it("builds verify rate-limit keys from client IP", () => {
    const key = getSep10VerifyRateLimitKey({ ip: "203.0.113.10" });
    expect(key).toBe("sep10:verify:203.0.113.10");
  });

  it("rate-limits repeated challenge requests for the same account", async () => {
    const limiter = createSep10ChallengeRateLimit({ max: 1, windowMs: 60_000 });
    const app = createApp(createAuthRouter({ sep10ChallengeRateLimit: limiter }));

    await request(app)
      .post("/api/auth/challenge")
      .send({ account: clientKeypair.publicKey() })
      .expect(200);

    const limited = await request(app)
      .post("/api/auth/challenge")
      .send({ account: clientKeypair.publicKey() });

    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("SEP10_RATE_LIMITED");
  });

  it("returns retryable 503 when merchant lookup store is temporarily unavailable", async () => {
    const challengeRes = await request(
      createApp(createAuthRouter({ sep10VerifyRateLimit: createSep10VerifyRateLimit({ max: 100 }) })),
    )
      .post("/api/auth/challenge")
      .send({ account: clientKeypair.publicKey() })
      .expect(200);

    const tx = StellarSdk.TransactionBuilder.fromXDR(
      challengeRes.body.transaction,
      StellarSdk.Networks.TESTNET,
    );
    tx.sign(clientKeypair);

    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "fetch failed: upstream timeout" },
    });

    const response = await request(
      createApp(createAuthRouter({ sep10VerifyRateLimit: createSep10VerifyRateLimit({ max: 100 }) })),
    )
      .post("/api/auth/verify")
      .send({ transaction: tx.toXDR() });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "SERVICE_UNAVAILABLE",
      message: "Authentication store temporarily unavailable, please retry",
      retryable: true,
    });
  });

  it("rate-limits repeated verify attempts from the same IP", async () => {
    const verifyLimiter = createSep10VerifyRateLimit({ max: 1, windowMs: 60_000 });
    const app = createApp(createAuthRouter({ sep10VerifyRateLimit: verifyLimiter }));

    const invalidTx = { transaction: "not-valid-base64!!!" };
    const first = await request(app).post("/api/auth/verify").send(invalidTx);
    const second = await request(app).post("/api/auth/verify").send(invalidTx);

    expect(first.status).toBe(400);
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("SEP10_RATE_LIMITED");
  });

  describe("verify race conditions (#1295)", () => {
    const unlimited = () => createSep10VerifyRateLimit({ max: 1000 });

    async function signedChallengeXdr(app) {
      const challengeRes = await request(app)
        .post("/api/auth/challenge")
        .send({ account: clientKeypair.publicKey() })
        .expect(200);
      const tx = StellarSdk.TransactionBuilder.fromXDR(
        challengeRes.body.transaction,
        StellarSdk.Networks.TESTNET,
      );
      tx.sign(clientKeypair);
      return tx.toXDR();
    }

    it("issues exactly one session for concurrent submissions of the same challenge", async () => {
      const app = createApp(createAuthRouter({ sep10VerifyRateLimit: unlimited() }));
      const xdr = await signedChallengeXdr(app);

      // Slow store lookup widens the window between verification and token issuance.
      mockMaybeSingle.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ data: { id: "m-1", email: "m@example.com" }, error: null }),
              25,
            ),
          ),
      );

      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          request(app).post("/api/auth/verify").send({ transaction: xdr }),
        ),
      );

      const ok = responses.filter((r) => r.status === 200);
      const replayed = responses.filter((r) => r.body.code === "NONCE_REPLAY");
      expect(ok).toHaveLength(1);
      expect(replayed).toHaveLength(7);
      expect(ok[0].body.token).toBeTruthy();
    });

    it("an unsigned copy submitted first does not lock out the real client", async () => {
      const app = createApp(createAuthRouter({ sep10VerifyRateLimit: unlimited() }));
      const challengeRes = await request(app)
        .post("/api/auth/challenge")
        .send({ account: clientKeypair.publicKey() })
        .expect(200);

      const attacker = await request(app)
        .post("/api/auth/verify")
        .send({ transaction: challengeRes.body.transaction });
      expect(attacker.status).toBe(401);
      expect(attacker.body.code).toBe("CLIENT_SIGNATURE_INVALID");

      const tx = StellarSdk.TransactionBuilder.fromXDR(
        challengeRes.body.transaction,
        StellarSdk.Networks.TESTNET,
      );
      tx.sign(clientKeypair);
      mockMaybeSingle.mockResolvedValue({ data: { id: "m-1", email: "m@example.com" }, error: null });

      const legit = await request(app).post("/api/auth/verify").send({ transaction: tx.toXDR() });
      expect(legit.status).toBe(200);
    });

    it("a retryable store outage releases the nonce so the retry succeeds", async () => {
      const app = createApp(createAuthRouter({ sep10VerifyRateLimit: unlimited() }));
      const xdr = await signedChallengeXdr(app);

      mockMaybeSingle.mockResolvedValue({
        data: null,
        error: { message: "fetch failed: upstream timeout" },
      });
      const outage = await request(app).post("/api/auth/verify").send({ transaction: xdr });
      expect(outage.status).toBe(503);
      expect(outage.body.retryable).toBe(true);

      mockMaybeSingle.mockResolvedValue({ data: { id: "m-1", email: "m@example.com" }, error: null });
      const retry = await request(app).post("/api/auth/verify").send({ transaction: xdr });
      expect(retry.status).toBe(200);
      expect(retry.body.merchant.id).toBe("m-1");

      const replay = await request(app).post("/api/auth/verify").send({ transaction: xdr });
      expect(replay.body.code).toBe("NONCE_REPLAY");
    });

    it("keeps the nonce consumed when no merchant matches the account", async () => {
      const app = createApp(createAuthRouter({ sep10VerifyRateLimit: unlimited() }));
      const xdr = await signedChallengeXdr(app);

      mockMaybeSingle.mockResolvedValue({ data: null, error: null });
      const first = await request(app).post("/api/auth/verify").send({ transaction: xdr });
      expect(first.status).toBe(401);

      const second = await request(app).post("/api/auth/verify").send({ transaction: xdr });
      expect(second.body.code).toBe("NONCE_REPLAY");
    });
  });

  describe("challenge network passphrase (#1294)", () => {
    const original = process.env.STELLAR_NETWORK;

    afterEach(() => {
      if (original === undefined) delete process.env.STELLAR_NETWORK;
      else process.env.STELLAR_NETWORK = original;
    });

    it("advertises the passphrase the challenge was actually built with", async () => {
      // An upper-case value is lower-cased by the signer (public network) but
      // the old route compared it case-sensitively and advertised testnet.
      process.env.STELLAR_NETWORK = "PUBLIC";
      vi.resetModules();
      const { default: createFreshAuthRouter } = await import("./auth.js");
      const app = createApp(createFreshAuthRouter());

      const res = await request(app)
        .post("/api/auth/challenge")
        .send({ account: clientKeypair.publicKey() })
        .expect(200);

      expect(res.body.network_passphrase).toBe(StellarSdk.Networks.PUBLIC);
      const tx = StellarSdk.TransactionBuilder.fromXDR(
        res.body.transaction,
        res.body.network_passphrase,
      );
      expect(tx.networkPassphrase).toBe(StellarSdk.Networks.PUBLIC);
      expect(tx.signatures).toHaveLength(1);
      expect(
        serverKeypair.verify(tx.hash(), tx.signatures[0].signature()),
      ).toBe(true);
    });
  });
});
