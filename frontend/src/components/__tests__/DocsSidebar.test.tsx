import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DocsSidebar from "../DocsSidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/docs/api-guide",
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe("DocsSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders navigation links and filters docs by search query", () => {
    render(<DocsSidebar />);

    expect(screen.getByRole("navigation", { name: /developer documentation/i })).toBeInTheDocument();
    expect(screen.getByText("Subscription API Guide")).toBeInTheDocument();
    expect(screen.getByText("How to verify HMAC signatures")).toBeInTheDocument();

    const searchInput = screen.getByLabelText(/filter documentation/i);
    fireEvent.change(searchInput, { target: { value: "HMAC" } });

    expect(screen.getByText("How to verify HMAC signatures")).toBeInTheDocument();
    expect(screen.queryByText("Subscription API Guide")).not.toBeInTheDocument();
  });

  it("applies optimistic bookmark update and keeps it on network success", async () => {
    const onSyncPreference = vi.fn().mockResolvedValue(undefined);
    render(<DocsSidebar onSyncPreference={onSyncPreference} />);

    const bookmarkBtn = screen.getByRole("button", {
      name: /bookmark subscription api guide/i,
    });
    expect(bookmarkBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(bookmarkBtn);

    // Optimistically updated immediately
    expect(bookmarkBtn).toHaveAttribute("aria-pressed", "true");

    await waitFor(() => {
      expect(onSyncPreference).toHaveBeenCalledWith({
        type: "bookmark",
        slug: "api-guide",
        value: true,
      });
    });

    expect(bookmarkBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rolls back optimistic bookmark state and displays toast feedback on network failure", async () => {
    const onSyncPreference = vi.fn().mockRejectedValue(new Error("Network offline"));
    const onToast = vi.fn();

    render(
      <DocsSidebar
        onSyncPreference={onSyncPreference}
        onToast={onToast}
      />,
    );

    const bookmarkBtn = screen.getByRole("button", {
      name: /bookmark subscription api guide/i,
    });
    fireEvent.click(bookmarkBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /network error: could not save bookmark\. changes reverted\./i,
      );
    });

    // State rolled back to false
    expect(bookmarkBtn).toHaveAttribute("aria-pressed", "false");
    expect(onToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        retryAction: { type: "bookmark", slug: "api-guide", value: true },
      }),
    );
  });

  it("supports retrying a failed preference sync from the rollback toast", async () => {
    const onSyncPreference = vi
      .fn()
      .mockRejectedValueOnce(new Error("Timeout"))
      .mockResolvedValueOnce(undefined);

    render(<DocsSidebar onSyncPreference={onSyncPreference} />);

    const bookmarkBtn = screen.getByRole("button", {
      name: /bookmark subscription api guide/i,
    });
    fireEvent.click(bookmarkBtn);

    const retryBtn = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(onSyncPreference).toHaveBeenCalledTimes(2);
      expect(bookmarkBtn).toHaveAttribute("aria-pressed", "true");
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rolls back collapse state on network failure", async () => {
    const onSyncPreference = vi.fn().mockRejectedValue(new Error("503"));
    render(<DocsSidebar onSyncPreference={onSyncPreference} />);

    const toggleBtn = screen.getByRole("button", { name: /guides/i });
    expect(toggleBtn).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /could not save sidebar layout preference/i,
      );
    });

    expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
  });
});
