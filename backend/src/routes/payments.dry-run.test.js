import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import createPaymentsRouter from "./payments.js";
import { supabase } from "../lib/supabase.js";

function createResponse() {
  return {
    status: vi.fn(),
    json: vi.fn(),
  };
}

function getCreatePaymentHandler() {
  const router = createPaymentsRouter({
    verifyPaymentRateLimit: (req, res, next) => next(),
  });
  const createPaymentLayer = router.stack.find(
    (layer) => layer.route?.path === "/create-payment",
  );
  return createPaymentLayer.route.stack.at(-1).handle;
}

describe("create-payment dry_run", () => {
  let handler;
  let res;
  let next;
  let insert;
  let from;

  beforeEach(() => {
    handler = getCreatePaymentHandler();
    res = createResponse();
    res.status.mockReturnValue(res);
    next = vi.fn();

    insert = vi.fn().mockResolvedValue({ error: null });
    from = vi.fn(() => ({ insert }));
    supabase.from.mockImplementation(from);
  });

  it("returns a preview and does not persist when dry_run=true", async () => {
    const req = {
      query: { dry_run: "true" },
      merchant: { id: "merchant-1" },
      body: {
        amount: 12.5,
        asset: "XLM",
        recipient: "GRECIPIENTADDRESS",
        description: "Preview payment",
      },
      get: vi.fn(() => undefined),
    };

    await handler(req, res, next);

    expect(from).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        dry_run: true,
        status: "pending",
        payment_link: expect.stringContaining("/pay/"),
        payment: expect.objectContaining({
          merchant_id: "merchant-1",
          amount: 12.5,
          asset: "XLM",
          description: "Preview payment",
          status: "pending",
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("persists normally when dry_run is not enabled", async () => {
    const req = {
      query: {},
      merchant: { id: "merchant-1" },
      body: {
        amount: 12.5,
        asset: "XLM",
        recipient: "GRECIPIENTADDRESS",
      },
      get: vi.fn(() => undefined),
    };

    await handler(req, res, next);

    expect(from).toHaveBeenCalledWith("payments");
    expect(insert).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });
});
