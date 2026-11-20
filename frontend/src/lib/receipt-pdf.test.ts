// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createReceiptPdf, downloadReceiptPdf, type ReceiptPdfData } from "./receipt-pdf";

const base: ReceiptPdfData = {
  merchantName: "Acme (Test)",
  paymentId: "pay_123",
  amount: "10.5",
  asset: "USDC",
  status: "Confirmed",
  date: "Nov 20, 2026",
  recipient: "GABC",
  transactionHash: "abc123",
  description: "Order #1",
};

const readText = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsText(blob);
  });

describe("createReceiptPdf", () => {
  it("returns a PDF blob with header and EOF marker", async () => {
    const blob = createReceiptPdf(base);
    expect(blob.type).toBe("application/pdf");
    const text = await readText(blob);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.endsWith("%%EOF")).toBe(true);
  });

  it("escapes parentheses and backslashes in text", async () => {
    const text = await readText(createReceiptPdf({ ...base, merchantName: "A(b)\\c" }));
    expect(text).toContain("(A\\(b\\)\\\\c) Tj");
  });

  it("strips non-ASCII characters", async () => {
    const text = await readText(createReceiptPdf({ ...base, description: "Caf\u00e9 \u2603" }));
    expect(text).not.toMatch(/[^\x00-\x7F]/);
  });

  it("truncates long transaction hashes", async () => {
    const text = await readText(createReceiptPdf({ ...base, transactionHash: "x".repeat(200) }));
    expect(text).toContain("x".repeat(57) + "...");
    expect(text).not.toContain("x".repeat(61));
  });

  it("uses green for confirmed and amber for other statuses", async () => {
    expect(await readText(createReceiptPdf(base))).toContain("0.18 0.8 0.44 rg");
    expect(await readText(createReceiptPdf({ ...base, status: "Pending" }))).toContain("0.95 0.6 0.1 rg");
  });

  it("omits the description row when empty", async () => {
    expect(await readText(createReceiptPdf({ ...base, description: "  " }))).not.toContain("DESCRIPTION");
  });

  it("falls back to PLUTO when merchant name is missing", async () => {
    expect(await readText(createReceiptPdf({ ...base, merchantName: null }))).toContain("(PLUTO) Tj");
  });
});

describe("downloadReceiptPdf", () => {
  let click: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    click = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => vi.restoreAllMocks());

  it("fires optimistic then success hooks and clicks a download link", async () => {
    const order: string[] = [];
    const ok = await downloadReceiptPdf(base, "r.pdf", {
      onOptimistic: () => order.push("optimistic"),
      onSuccess: () => order.push("success"),
      onRollback: () => order.push("rollback"),
    });
    expect(ok).toBe(true);
    expect(order).toEqual(["optimistic", "success"]);
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("rolls back exactly once and resolves false when the download fails", async () => {
    URL.createObjectURL = vi.fn(() => {
      throw new Error("boom");
    });
    const onRollback = vi.fn();
    const onSuccess = vi.fn();
    const ok = await downloadReceiptPdf(base, "r.pdf", { onRollback, onSuccess });
    expect(ok).toBe(false);
    expect(onRollback).toHaveBeenCalledOnce();
    expect(onRollback.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("revokes the object URL after the download", async () => {
    vi.useFakeTimers();
    await downloadReceiptPdf(base, "r.pdf");
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    vi.useRealTimers();
  });
});
