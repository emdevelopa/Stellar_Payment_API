import { describe, expect, it, vi } from "vitest";
import {
  isRetryableWebhookLog,
  queueBulkWebhookRetries,
  queueWebhookRetry,
} from "./webhook-retries.js";

describe.skip("webhook-retries (Delivery Worker)", () => {
  it("marks 4xx and 5xx webhook logs as retryable", () => {
    expect(isRetryableWebhookLog({ status_code: 400 })).toBe(true);
    expect(isRetryableWebhookLog({ status_code: 503 })).toBe(true);
    expect(isRetryableWebhookLog({ status_code: 200 })).toBe(false);
  });
});

describe("queueWebhookRetry", () => {
  it("schedules a webhook dispatch asynchronously", () => {
    const schedule = vi.fn((callback) => callback());
    const dispatchWebhook = vi.fn().mockResolvedValue({ ok: true });

    queueWebhookRetry(
      {
        url: "https://merchant.example/webhook",
        payload: { event: "payment.confirmed" },
        secret: "whsec_test",
      },
      { dispatchWebhook, schedule },
    );

    expect(schedule).toHaveBeenCalledOnce();
    expect(dispatchWebhook).toHaveBeenCalledWith(
      "https://merchant.example/webhook",
      { event: "payment.confirmed" },
      "whsec_test",
    );
  });
});

describe("queueBulkWebhookRetries", () => {
  it("queues only the selected failed webhook logs", async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            status_code: 500,
            webhook_url: "https://merchant.example/webhook",
            payment_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            amount: "12.50",
            asset: "XLM",
            asset_issuer: null,
            recipient: "GABC123",
            tx_id: "tx-failed",
            webhook_secret: "whsec_current",
            webhook_version: "v1",
          },
          {
            id: "22222222-2222-2222-2222-222222222222",
            status_code: 200,
            webhook_url: "https://merchant.example/webhook",
            payment_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            amount: "7.00",
            asset: "XLM",
            asset_issuer: null,
            recipient: "GDEF456",
            tx_id: "tx-success",
            webhook_secret: "whsec_current",
            webhook_version: "v1",
          },
        ],
      }),
    };
    const queueWebhook = vi.fn();

    const result = await queueBulkWebhookRetries(
      {
        db,
        merchantId: "merchant-123",
        logIds: [
          "11111111-1111-1111-1111-111111111111",
          "22222222-2222-2222-2222-222222222222",
          "11111111-1111-1111-1111-111111111111",
        ],
      },
      { queueWebhook },
    );

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("from webhook_delivery_logs"), [
      "merchant-123",
      [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
      ],
    ]);
    expect(queueWebhook).toHaveBeenCalledOnce();
    expect(queueWebhook).toHaveBeenCalledWith({
      url: "https://merchant.example/webhook",
      payload: {
        event: "payment.confirmed",
        payment_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        amount: "12.50",
        asset: "XLM",
        asset_issuer: null,
        recipient: "GABC123",
        tx_id: "tx-failed",
      },
      secret: "whsec_current",
    });
    expect(result).toEqual({
      requested_count: 2,
      queued_count: 1,
      skipped_count: 1,
      queued_log_ids: ["11111111-1111-1111-1111-111111111111"],
    });
  });
});
