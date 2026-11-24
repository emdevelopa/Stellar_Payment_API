import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendReceiptEmail } from "./email.js";
import { renderReceiptEmail } from "./email-templates.js";

// ---------------------------------------------------------------------------
// sendReceiptEmail
// ---------------------------------------------------------------------------

vi.mock("resend", () => {
  const mockSend = vi.fn();
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: { send: mockSend },
    })),
    __mockSend: mockSend,
  };
});

// Helper to obtain the mock from the module cache
async function getMockSend() {
  const mod = await import("resend");
  return mod.__mockSend;
}

describe("sendReceiptEmail", () => {
  beforeEach(async () => {
    const mockSend = await getMockSend();
    mockSend.mockReset();
  });

  it("returns { ok: true } when Resend succeeds", async () => {
    const mockSend = await getMockSend();
    mockSend.mockResolvedValue({ data: { id: "abc" }, error: null });

    const result = await sendReceiptEmail({
      to: "merchant@example.com",
      subject: "Receipt",
      html: "<p>hello</p>",
    });

    expect(result).toEqual({ ok: true });
  });

  it("returns { ok: false, error } when Resend returns an error object", async () => {
    const mockSend = await getMockSend();
    const apiError = { message: "Invalid API key", statusCode: 401 };
    mockSend.mockResolvedValue({ data: null, error: apiError });

    const result = await sendReceiptEmail({
      to: "merchant@example.com",
      subject: "Receipt",
      html: "<p>hello</p>",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe(apiError);
  });

  it("returns { ok: false, error } when Resend throws — does not throw", async () => {
    const mockSend = await getMockSend();
    mockSend.mockRejectedValue(new Error("Network error"));

    const result = await sendReceiptEmail({
      to: "merchant@example.com",
      subject: "Receipt",
      html: "<p>hello</p>",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// renderReceiptEmail
// ---------------------------------------------------------------------------

describe("renderReceiptEmail", () => {
  const payment = {
    id: "pay-123",
    amount: "42.50",
    asset: "USDC",
    recipient: "GXXXXRECIPIENT",
    tx_id: "TX_HASH_ABCDEF",
    created_at: "2026-03-27T16:00:00.000Z",
  };

  const merchant = { name: "Acme Corp" };

  it("returns a string", () => {
    expect(typeof renderReceiptEmail({ payment, merchant })).toBe("string");
  });

  it("includes the merchant name", () => {
    const html = renderReceiptEmail({ payment, merchant });
    expect(html).toContain("Acme Corp");
  });

  it("includes the amount and asset", () => {
    const html = renderReceiptEmail({ payment, merchant });
    expect(html).toContain("42.50");
    expect(html).toContain("USDC");
  });

  it("includes the transaction ID", () => {
    const html = renderReceiptEmail({ payment, merchant });
    expect(html).toContain("TX_HASH_ABCDEF");
  });

  it("includes the recipient address", () => {
    const html = renderReceiptEmail({ payment, merchant });
    expect(html).toContain("GXXXXRECIPIENT");
  });

  it("handles missing merchant gracefully", () => {
    expect(() =>
      renderReceiptEmail({ payment, merchant: null })
    ).not.toThrow();
  });
});

describe("renderReceiptEmail escaping (#1769)", () => {
  it("escapes merchant-controlled text and drops unsafe logo URLs", () => {
    const html = renderReceiptEmail({
      payment: { amount: "1<i>", asset: "XLM" },
      merchant: {
        business_name: '"><script>alert(1)</script>',
        branding_config: { logo_url: "javascript:alert(1)" },
      },
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("1&lt;i&gt;");
  });

  it("keeps a valid https logo", () => {
    const html = renderReceiptEmail({
      payment: {},
      merchant: { business_name: "Shop", branding_config: { logo_url: "https://cdn.example.com/l.png" } },
    });
    expect(html).toContain('src="https://cdn.example.com/l.png"');
  });
});
