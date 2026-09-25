/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import SystemStatus from "./SystemStatus";

describe("SystemStatus", () => {
  const originalStatusUrl = process.env.NEXT_PUBLIC_STATUS_PAGE_URL;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_STATUS_PAGE_URL", "https://status.example.com");
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    if (originalStatusUrl) {
      process.env.NEXT_PUBLIC_STATUS_PAGE_URL = originalStatusUrl;
    } else {
      delete process.env.NEXT_PUBLIC_STATUS_PAGE_URL;
    }
  });

  it("renders the last known healthy state while a refresh is in flight", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        page: { name: "Status" },
        status: {
          indicator: "none",
          description: "All Systems Operational",
        },
      }),
    });

    render(React.createElement(SystemStatus));

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("All Systems Operational")).toBeInTheDocument();

    (global.fetch as any).mockImplementationOnce(
      () =>
        new Promise(() => {
          // Keep the optimistic refresh pending.
        }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });

    expect(
      screen.getByText("All Systems Operational (Refreshing)"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Refreshing system status/i)).toBeInTheDocument();
  });

  it("keeps the previous status visible after a transient polling failure", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        page: { name: "Status" },
        status: {
          indicator: "minor",
          description: "Minor degradation",
        },
      }),
    });

    render(React.createElement(SystemStatus));

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Minor degradation")).toBeInTheDocument();

    (global.fetch as any).mockRejectedValueOnce(new Error("temporary outage"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });

    expect(screen.getByText("Minor degradation")).toBeInTheDocument();
    expect(screen.getByLabelText(/Last known system status/i)).toBeInTheDocument();
    expect(screen.queryByText("Status Unknown")).not.toBeInTheDocument();
  });
});
