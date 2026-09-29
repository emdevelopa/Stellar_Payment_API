import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createSep0001Router } from "./sep0001.js";

const MERCHANT_ID = "3f0c6a8e-6b1d-4c4e-9a53-1f3d2b7c9e10";
const RESULT = {
  toml: 'NETWORK_PASSPHRASE = "x"\nTRANSFER_SERVER = "y"',
  digest: "a".repeat(64),
  source: "shared",
};

function createApp(getStellarToml, merchant) {
  const app = express();
  if (merchant) {
    app.use((req, _res, next) => {
      req.merchant = merchant;
      next();
    });
  }
  app.use(createSep0001Router({ getCoordinator: () => ({ getStellarToml }) }));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

describe("GET /.well-known/stellar.toml", () => {
  let getStellarToml;

  beforeEach(() => {
    getStellarToml = vi.fn(async () => RESULT);
  });

  it("returns the TOML with caching headers and a strong ETag", async () => {
    const res = await request(createApp(getStellarToml)).get(
      `/.well-known/stellar.toml?merchant_id=${MERCHANT_ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.text).toBe(RESULT.toml);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    expect(res.headers.etag).toBe(`"${RESULT.digest}"`);
    expect(getStellarToml).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it("normalizes merchant_id casing so one merchant maps to one cache key", async () => {
    await request(createApp(getStellarToml)).get(
      `/.well-known/stellar.toml?merchant_id=${MERCHANT_ID.toUpperCase()}`,
    );
    expect(getStellarToml).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it("answers 304 when If-None-Match matches", async () => {
    const res = await request(createApp(getStellarToml))
      .get(`/.well-known/stellar.toml?merchant_id=${MERCHANT_ID}`)
      .set("If-None-Match", `W/"other", "${RESULT.digest}"`);
    expect(res.status).toBe(304);
    expect(res.text).toBe("");
  });

  it("falls back to the authenticated merchant", async () => {
    const res = await request(createApp(getStellarToml, { id: MERCHANT_ID })).get(
      "/.well-known/stellar.toml",
    );
    expect(res.status).toBe(200);
    expect(getStellarToml).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it("requires merchant_id", async () => {
    const res = await request(createApp(getStellarToml)).get("/.well-known/stellar.toml");
    expect(res.status).toBe(400);
    expect(getStellarToml).not.toHaveBeenCalled();
  });

  it.each(["not-a-uuid", "sep1:{x}:lock", "*", `${MERCHANT_ID}x`])(
    "rejects malformed merchant_id %s before any lookup",
    async (bad) => {
      const res = await request(createApp(getStellarToml))
        .get("/.well-known/stellar.toml")
        .query({ merchant_id: bad });
      expect(res.status).toBe(400);
      expect(getStellarToml).not.toHaveBeenCalled();
    },
  );

  it("rejects array-valued merchant_id (parameter pollution)", async () => {
    const res = await request(createApp(getStellarToml)).get(
      `/.well-known/stellar.toml?merchant_id=${MERCHANT_ID}&merchant_id=${MERCHANT_ID}`,
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown merchants", async () => {
    getStellarToml.mockResolvedValue(null);
    const res = await request(createApp(getStellarToml)).get(
      `/.well-known/stellar.toml?merchant_id=${MERCHANT_ID}`,
    );
    expect(res.status).toBe(404);
  });

  it("returns 500 when generation fails", async () => {
    getStellarToml.mockRejectedValue(Object.assign(new Error("Failed to fetch merchant"), { status: 500 }));
    const res = await request(createApp(getStellarToml)).get(
      `/.well-known/stellar.toml?merchant_id=${MERCHANT_ID}`,
    );
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to fetch merchant");
  });
});
