/**
 * Service-level guards for the Merchant Settings & API Key Service
 * (issue #1482) — defense in depth for callers that bypass HTTP validation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdate, mockFrom } = vi.hoisted(() => {
  const mockUpdate = vi.fn();
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: { api_key: "sk_old" }, error: null })),
    update: vi.fn((payload) => {
      mockUpdate(payload);
      return { eq: vi.fn(async () => ({ error: null })) };
    }),
  };
  return { mockUpdate, mockFrom: vi.fn(() => chain) };
});

vi.mock("../lib/supabase.js", () => ({ supabase: { from: mockFrom } }));
vi.mock("../lib/webhooks.js", () => ({ sendWebhook: vi.fn() }));
vi.mock("../webhooks/resolver.js", () => ({ getPayloadForVersion: vi.fn() }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { merchantService } from "./merchantService.js";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => vi.clearAllMocks());

describe("merchantService.setApiKeyExpiry", () => {
  it("normalizes and persists a valid expiry", async () => {
    const future = new Date(Date.now() + 10 * DAY);
    const result = await merchantService.setApiKeyExpiry(
      "merchant-1",
      future.toISOString().replace("Z", "+00:00"),
    );
    expect(result).toEqual({ api_key_expires_at: future.toISOString() });
    expect(mockUpdate).toHaveBeenCalledWith({ api_key_expires_at: future.toISOString() });
  });

  it.each([
    ["past", "2001-01-01T00:00:00Z"],
    ["too far", new Date(Date.now() + 1000 * DAY).toISOString()],
    ["garbage", "soon"],
    ["non-string", 12345],
  ])("rejects a %s expiry with 400 and does not write", async (_label, value) => {
    await expect(merchantService.setApiKeyExpiry("merchant-1", value)).rejects.toMatchObject({
      status: 400,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a missing merchantId", async () => {
    const future = new Date(Date.now() + DAY).toISOString();
    await expect(merchantService.setApiKeyExpiry("", future)).rejects.toMatchObject({ status: 400 });
    await expect(merchantService.setApiKeyExpiry(undefined, future)).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("merchantService.rotateApiKey", () => {
  it("clamps the grace period to one week", async () => {
    const result = await merchantService.rotateApiKey("merchant-1", 10_000);
    expect(result.grace_period_hours).toBe(168);
  });

  it("uses the default grace period when none is supplied", async () => {
    const result = await merchantService.rotateApiKey("merchant-1", undefined);
    expect(result.grace_period_hours).toBe(24);
  });

  it.each([["string", "24"], ["float", 1.5], ["NaN", Number.NaN]])(
    "rejects a %s grace period with 400 instead of crashing with a 500",
    async (_label, value) => {
      await expect(merchantService.rotateApiKey("merchant-1", value)).rejects.toMatchObject({
        status: 400,
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing merchantId before touching the database", async () => {
    await expect(merchantService.rotateApiKey(null)).rejects.toMatchObject({ status: 400 });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
