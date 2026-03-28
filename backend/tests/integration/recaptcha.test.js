import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { recaptchaMiddleware } from "../../src/lib/recaptcha.js";

function makeApp(envSecret) {
  const app = express();
  app.use(express.json());

  // Temporarily set the env var for this app instance
  if (envSecret) process.env.RECAPTCHA_SECRET_KEY = envSecret;
  else delete process.env.RECAPTCHA_SECRET_KEY;

  app.post("/test", recaptchaMiddleware(), (req, res) => {
    res.json({ ok: true, recaptcha: req.recaptcha ?? null });
  });

  return app;
}

describe("recaptchaMiddleware", () => {
  afterEach(() => {
    delete process.env.RECAPTCHA_SECRET_KEY;
    vi.restoreAllMocks();
  });

  it("is a no-op when RECAPTCHA_SECRET_KEY is not set", async () => {
    const app = makeApp(undefined);
    const res = await request(app).post("/test").send({ amount: 10 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 400 when token is missing and secret is configured", async () => {
    const app = makeApp("test-secret");
    const res = await request(app).post("/test").send({ amount: 10 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RECAPTCHA_MISSING");
  });

  it("returns 403 when Google returns success=false", async () => {
    vi.stubGlobal("fetch", async () => ({
      json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
    }));

    const app = makeApp("test-secret");
    const res = await request(app)
      .post("/test")
      .send({ "g-recaptcha-response": "bad-token" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RECAPTCHA_FAILED");
  });

  it("returns 403 when v3 score is below minimum", async () => {
    vi.stubGlobal("fetch", async () => ({
      json: async () => ({ success: true, score: 0.1 }),
    }));

    const app = makeApp("test-secret");
    const res = await request(app)
      .post("/test")
      .send({ "g-recaptcha-response": "low-score-token" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RECAPTCHA_SCORE_LOW");
  });

  it("passes through and attaches result when verification succeeds", async () => {
    vi.stubGlobal("fetch", async () => ({
      json: async () => ({ success: true, score: 0.9 }),
    }));

    const app = makeApp("test-secret");
    const res = await request(app)
      .post("/test")
      .send({ "g-recaptcha-response": "good-token" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.recaptcha.success).toBe(true);
  });

  it("fails open (next()) when Google call throws a network error", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("network error"); });

    const app = makeApp("test-secret");
    const res = await request(app)
      .post("/test")
      .send({ "g-recaptcha-response": "any-token" });

    // Should not block the request on Google outage
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
