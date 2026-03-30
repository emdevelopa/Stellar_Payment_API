import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase.js", () => ({
  supabase: { from: vi.fn() },
}));
vi.mock("dotenv/config", () => ({}));

import { isEventSubscribed } from "./webhooks.js";
import { webhookSettingsSchema, VALID_WEBHOOK_EVENTS } from "./request-schemas.js";

// ── isEventSubscribed ─────────────────────────────────────────────────────────

describe("isEventSubscribed", () => {
  it("returns true when subscribed_events is null (receive all)", () => {
    expect(isEventSubscribed({ subscribed_events: null }, "payment.confirmed")).toBe(true);
  });

  it("returns true when subscribed_events is undefined (receive all)", () => {
    expect(isEventSubscribed({}, "payment.confirmed")).toBe(true);
  });

  it("returns true when subscribed_events is an empty array (receive all)", () => {
    expect(isEventSubscribed({ subscribed_events: [] }, "payment.confirmed")).toBe(true);
  });

  it("returns true when the event is in the subscribed list", () => {
    expect(
      isEventSubscribed(
        { subscribed_events: ["payment.confirmed", "payment.failed"] },
        "payment.confirmed",
      ),
    ).toBe(true);
  });

  it("returns false when the event is NOT in the subscribed list", () => {
    expect(
      isEventSubscribed(
        { subscribed_events: ["payment.failed"] },
        "payment.confirmed",
      ),
    ).toBe(false);
  });

  it("returns false for an unrelated event type when list is restricted", () => {
    expect(
      isEventSubscribed(
        { subscribed_events: ["payment.confirmed"] },
        "payment.expired",
      ),
    ).toBe(false);
  });

  it("returns true when merchant is null (defensive)", () => {
    expect(isEventSubscribed(null, "payment.confirmed")).toBe(true);
  });

  it("returns true when merchant is undefined (defensive)", () => {
    expect(isEventSubscribed(undefined, "payment.confirmed")).toBe(true);
  });

  it("handles a single-event subscription list correctly", () => {
    const merchant = { subscribed_events: ["payment.expired"] };
    expect(isEventSubscribed(merchant, "payment.expired")).toBe(true);
    expect(isEventSubscribed(merchant, "payment.confirmed")).toBe(false);
    expect(isEventSubscribed(merchant, "payment.failed")).toBe(false);
  });
});

// ── webhookSettingsSchema — subscribed_events field ───────────────────────────

describe("webhookSettingsSchema — subscribed_events validation", () => {
  it("accepts a valid list of event types", () => {
    const result = webhookSettingsSchema.safeParse({
      subscribed_events: ["payment.confirmed", "payment.failed"],
    });
    expect(result.success).toBe(true);
    expect(result.data.subscribed_events).toEqual(["payment.confirmed", "payment.failed"]);
  });

  it("accepts null to clear all subscriptions", () => {
    const result = webhookSettingsSchema.safeParse({ subscribed_events: null });
    expect(result.success).toBe(true);
    expect(result.data.subscribed_events).toBeNull();
  });

  it("accepts an empty array", () => {
    const result = webhookSettingsSchema.safeParse({ subscribed_events: [] });
    expect(result.success).toBe(true);
    expect(result.data.subscribed_events).toEqual([]);
  });

  it("accepts when subscribed_events is omitted", () => {
    const result = webhookSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data.subscribed_events).toBeUndefined();
  });

  it("rejects an unknown event type", () => {
    const result = webhookSettingsSchema.safeParse({
      subscribed_events: ["payment.unknown"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a mixed list with one invalid event", () => {
    const result = webhookSettingsSchema.safeParse({
      subscribed_events: ["payment.confirmed", "not.an.event"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts all VALID_WEBHOOK_EVENTS together", () => {
    const result = webhookSettingsSchema.safeParse({
      subscribed_events: VALID_WEBHOOK_EVENTS,
    });
    expect(result.success).toBe(true);
    expect(result.data.subscribed_events).toEqual(VALID_WEBHOOK_EVENTS);
  });

  it("VALID_WEBHOOK_EVENTS includes payment.confirmed, payment.failed, payment.expired", () => {
    expect(VALID_WEBHOOK_EVENTS).toContain("payment.confirmed");
    expect(VALID_WEBHOOK_EVENTS).toContain("payment.failed");
    expect(VALID_WEBHOOK_EVENTS).toContain("payment.expired");
  });
});
