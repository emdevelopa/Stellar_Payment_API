import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import TransactionHistoryPagination from "./TransactionHistoryPagination";

const messages = {
  recentPayments: {
    pagination: {
      ariaLabel: "Payment history pagination",
      previous: "Previous page",
      next: "Next page",
      goToPage: "Go to page {page}",
      currentPage: "Current page, page {page}",
      pageLabel: "Page {page} of {totalPages}",
      range: "Showing {start}-{end} of {total}",
    },
  },
};

function renderPagination(props: Partial<React.ComponentProps<typeof TransactionHistoryPagination>> = {}) {
  const defaultProps = {
    page: 1,
    totalPages: 5,
    totalCount: 220,
    limit: 50,
    onPageChange: vi.fn(),
  };
  const merged = { ...defaultProps, ...props };

  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TransactionHistoryPagination {...merged} />
    </NextIntlClientProvider>,
  );

  return merged;
}

describe("TransactionHistoryPagination", () => {
  it("renders nothing when there is only one page", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TransactionHistoryPagination page={1} totalPages={1} totalCount={10} limit={50} onPageChange={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are zero pages", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TransactionHistoryPagination page={1} totalPages={0} totalCount={0} limit={50} onPageChange={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the correct result range", () => {
    renderPagination({ page: 2, totalPages: 5, totalCount: 220, limit: 50 });
    expect(screen.getByText("Showing 51-100 of 220")).toBeInTheDocument();
  });

  it("disables the previous button on the first page", () => {
    renderPagination({ page: 1 });
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
  });

  it("disables the next button on the last page", () => {
    renderPagination({ page: 5, totalPages: 5 });
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });

  it("calls onPageChange with the next page when Next is clicked", () => {
    const { onPageChange } = renderPagination({ page: 2, totalPages: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("calls onPageChange with the previous page when Previous is clicked", () => {
    const { onPageChange } = renderPagination({ page: 2, totalPages: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("calls onPageChange with a specific page number when clicked", () => {
    const { onPageChange } = renderPagination({ page: 1, totalPages: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Go to page 3" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("marks the current page with aria-current", () => {
    renderPagination({ page: 3, totalPages: 5 });
    const current = screen.getByRole("button", { name: "Current page, page 3" });
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("collapses long page ranges with an ellipsis", () => {
    renderPagination({ page: 5, totalPages: 12 });
    expect(screen.getAllByText("…").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Go to page 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to page 12" })).toBeInTheDocument();
  });

  it("disables all controls when disabled prop is set", () => {
    renderPagination({ page: 2, totalPages: 5, disabled: true });
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Go to page 1" })).toBeDisabled();
  });
});
