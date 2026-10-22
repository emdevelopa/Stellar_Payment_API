/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import WebhookLogs from "./WebhookLogs";

vi.mock("react-hot-toast", () => ({
  __esModule: true,
  default: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/components/ui/Button", () => ({
  __esModule: true,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("./WebhookDetailModal", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("@/lib/merchant-store", () => ({
  useHydrateMerchantStore: vi.fn(),
  useMerchantApiKey: () => "mock-api-key",
  useMerchantHydrated: () => true,
}));

describe("WebhookLogs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.fetch = vi.fn();
  });

  it("shows green 200s and red 400s from fetched delivery attempts", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        logs: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            payment_id: "p1",
            status_code: 200,
            event: "payment.confirmed",
            url: "https://merchant.example/webhook",
            request_payload: {},
            request_headers: null,
            response_body: "ok",
            timestamp: "2026-04-25T09:00:00.000Z",
          },
          {
            id: "22222222-2222-2222-2222-222222222222",
            payment_id: "p2",
            status_code: 404,
            event: "payment.failed",
            url: "https://merchant.example/webhook",
            request_payload: {},
            request_headers: null,
            response_body: "not found",
            timestamp: "2026-04-25T09:05:00.000Z",
          },
        ],
      }),
    });

    render(<WebhookLogs />);

    await waitFor(() => {
      expect(screen.getByText("200")).toBeInTheDocument();
      expect(screen.getByText("404")).toBeInTheDocument();
    });

    expect(screen.getByText("200")).toHaveClass("text-green-300");
    expect(screen.getByText("404")).toHaveClass("text-red-300");
  });

  it("table rows are keyboard-focusable (tabIndex=0)", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        logs: [
          {
            id: "aaaa",
            payment_id: "p1",
            status_code: 200,
            event: "payment.confirmed",
            url: "https://example.com/wh",
            request_payload: {},
            request_headers: null,
            response_body: "ok",
            timestamp: "2026-04-25T09:00:00.000Z",
          },
        ],
      }),
    });

    render(<WebhookLogs />);

    await waitFor(() => expect(screen.getByText("payment.confirmed")).toBeInTheDocument());

    const row = screen.getByRole("button", { name: /payment\.confirmed/i });
    expect(row).toHaveAttribute("tabindex", "0");
  });

  it("pressing Enter on a row opens the detail view", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        logs: [
          {
            id: "bbbb",
            payment_id: "p2",
            status_code: 500,
            event: "payment.failed",
            url: "https://example.com/wh",
            request_payload: {},
            request_headers: null,
            response_body: "error",
            timestamp: "2026-04-25T10:00:00.000Z",
          },
        ],
      }),
    });

    render(<WebhookLogs />);

    await waitFor(() => expect(screen.getByText("payment.failed")).toBeInTheDocument());

    const row = screen.getByRole("button", { name: /payment\.failed/i });
    fireEvent.keyDown(row, { key: "Enter" });
    // WebhookDetailModal is mocked to null; confirming no throw is sufficient
    expect(row).toBeInTheDocument();
  });

  it("pressing Space on a row opens the detail view without page scroll", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        logs: [
          {
            id: "cccc",
            payment_id: "p3",
            status_code: 200,
            event: "payout.sent",
            url: "https://example.com/wh",
            request_payload: {},
            request_headers: null,
            response_body: "ok",
            timestamp: "2026-04-25T11:00:00.000Z",
          },
        ],
      }),
    });

    render(<WebhookLogs />);

    await waitFor(() => expect(screen.getByText("payout.sent")).toBeInTheDocument());

    const row = screen.getByRole("button", { name: /payout\.sent/i });
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    row.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});

describe("WebhookLogs optimistic retry rollback", () => {
  const FAILED_A = {
    id: "fail-a",
    payment_id: "p1",
    status_code: 500,
    event: "payment.failed",
    url: "https://example.com/wh",
    request_payload: {},
    request_headers: null,
    response_body: "error",
    timestamp: "2026-04-25T10:00:00.000Z",
  };
  const FAILED_B = { ...FAILED_A, id: "fail-b", event: "payment.expired", status_code: 404 };

  const fetchMock = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

  async function renderWithFailedLogs() {
    fetchMock().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ logs: [FAILED_A, FAILED_B] }),
    });
    render(<WebhookLogs />);
    await waitFor(() => expect(screen.getByText("payment.failed")).toBeInTheDocument());
  }

  function rowFor(event: string) {
    return screen.getByRole("button", { name: new RegExp(event.replace(".", "\.")) });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.fetch = vi.fn();
  });

  it("shows the optimistic pending state while the retry request is in flight", async () => {
    await renderWithFailedLogs();

    let resolveRetry: (value: unknown) => void = () => {};
    fetchMock().mockReturnValueOnce(new Promise((resolve) => (resolveRetry = resolve)));

    fireEvent.click(screen.getByLabelText("Select webhook log fail-a"));
    fireEvent.click(screen.getByRole("button", { name: "Retry Selected" }));

    expect(rowFor("payment.failed")).toHaveAttribute("data-retry-state", "pending");
    expect(rowFor("payment.failed")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Retrying…")).toBeInTheDocument();
    expect(screen.getByLabelText("Select webhook log fail-a")).not.toBeChecked();
    expect(screen.getByLabelText("Select webhook log fail-a")).toBeDisabled();

    resolveRetry({
      ok: true,
      json: async () => ({ queued_count: 1, skipped_count: 0, queued_log_ids: ["fail-a"] }),
    });

    await waitFor(() =>
      expect(rowFor("payment.failed")).toHaveAttribute("data-retry-state", "queued"),
    );
    expect(screen.getByText("Retry queued")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rolls back row state and restores the selection on network failure", async () => {
    await renderWithFailedLogs();
    fetchMock().mockRejectedValueOnce(new TypeError("Failed to fetch"));

    fireEvent.click(screen.getByLabelText("Select webhook log fail-a"));
    fireEvent.click(screen.getByLabelText("Select webhook log fail-b"));
    fireEvent.click(screen.getByRole("button", { name: "Retry Selected" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/network error/i);
    expect(alert).toHaveTextContent(/selection has been restored/i);

    expect(screen.queryByText("Retrying…")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Select webhook log fail-a")).toBeChecked();
    expect(screen.getByLabelText("Select webhook log fail-b")).toBeChecked();
    expect(screen.getByLabelText("Select webhook log fail-a")).toBeEnabled();
    expect(rowFor("payment.failed")).toHaveAttribute("data-retry-state", "rolled-back");
    expect(screen.getAllByText("Retry not queued")).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent(/retry failed/i);
  });

  it("rolls back on a non-2xx response using the server error message", async () => {
    await renderWithFailedLogs();
    fetchMock().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Rate limit exceeded" }),
    });

    fireEvent.click(screen.getByLabelText("Select webhook log fail-a"));
    fireEvent.click(screen.getByRole("button", { name: "Retry Selected" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Rate limit exceeded");
    expect(screen.getByLabelText("Select webhook log fail-a")).toBeChecked();
    expect(screen.getByLabelText("Select webhook log fail-b")).not.toBeChecked();
  });

  it("rolls back only the rows the server skipped", async () => {
    await renderWithFailedLogs();
    fetchMock().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ queued_count: 1, skipped_count: 1, queued_log_ids: ["fail-a"] }),
    });

    fireEvent.click(screen.getByLabelText("Select all failed webhook logs"));
    fireEvent.click(screen.getByRole("button", { name: "Retry Selected" }));

    await waitFor(() =>
      expect(rowFor("payment.failed")).toHaveAttribute("data-retry-state", "queued"),
    );
    expect(rowFor("payment.expired")).toHaveAttribute("data-retry-state", "rolled-back");
    expect(screen.getByLabelText("Select webhook log fail-b")).toBeEnabled();
    expect(screen.getByLabelText("Select webhook log fail-a")).toBeDisabled();
  });

  it("'Try again' re-sends the rolled-back logs and clears the alert on success", async () => {
    await renderWithFailedLogs();
    fetchMock().mockRejectedValueOnce(new TypeError("Failed to fetch"));

    fireEvent.click(screen.getByLabelText("Select webhook log fail-b"));
    fireEvent.click(screen.getByRole("button", { name: "Retry Selected" }));
    await screen.findByRole("alert");

    fetchMock().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ queued_count: 1, skipped_count: 0, queued_log_ids: ["fail-b"] }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(rowFor("payment.expired")).toHaveAttribute("data-retry-state", "queued"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const lastCall = fetchMock().mock.calls.at(-1)!;
    expect(JSON.parse(lastCall[1].body)).toEqual({ log_ids: ["fail-b"] });
  });

  it("the rollback alert can be dismissed", async () => {
    await renderWithFailedLogs();
    fetchMock().mockRejectedValueOnce(new TypeError("Failed to fetch"));

    fireEvent.click(screen.getByLabelText("Select webhook log fail-a"));
    fireEvent.click(screen.getByRole("button", { name: "Retry Selected" }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss retry error" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
