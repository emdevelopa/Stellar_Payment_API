import { beforeEach, describe, expect, it, vi } from "vitest";

const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const selectExisting = vi.fn(() => ({ eq }));
const single = vi.fn();
const selectInserted = vi.fn(() => ({ single }));
const insert = vi.fn(() => ({ select: selectInserted }));
const from = vi.fn(() => ({
  select: selectExisting,
  insert,
}));

vi.mock("../lib/supabase.js", () => ({
  supabase: { from },
}));

vi.mock("../lib/auth.js", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed-password"),
  requireApiKeyAuth: vi.fn(() => (req, res, next) => next()),
  requireSessionAuth: vi.fn(() => (req, res, next) => next()),
}));

vi.mock("../lib/sep10-auth.js", () => ({
  generateSessionToken: vi.fn(() => "session.jwt.token"),
}));

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

function getRegisterMerchantHandler(router) {
  const layer = router.stack.find(
    (entry) =>
      entry.route?.path === "/register-merchant" && entry.route?.methods?.post,
  );

  if (!layer) {
    throw new Error("register-merchant route not found");
  }

  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe("POST /api/register-merchant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeSingle.mockResolvedValue({ data: null });
    single.mockResolvedValue({
      data: {
        id: "merchant-123",
        email: "owner@example.com",
        business_name: "Pluto Store",
        notification_email: "alerts@example.com",
        merchant_settings: null,
        metadata: null,
        api_key: "sk_test",
        webhook_secret: "whsec_test",
        created_at: "2026-04-21T00:00:00.000Z",
      },
      error: null,
    });
  });

  it("returns a session token with the registered merchant", async () => {
    const { default: createMerchantsRouter } = await import("./merchants.js");
    const router = createMerchantsRouter();
    const handler = getRegisterMerchantHandler(router);
    const res = createResponse();
    const next = vi.fn();

    await handler(
      {
        body: {
          email: "owner@example.com",
          password: "correct horse battery staple",
          business_name: "Pluto Store",
          notification_email: "alerts@example.com",
        },
      },
      res,
      next,
    );

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "owner@example.com",
        password_hash: "hashed-password",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Merchant registered successfully",
        token: "session.jwt.token",
        merchant: expect.objectContaining({
          id: "merchant-123",
          email: "owner@example.com",
          api_key: "sk_test",
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
