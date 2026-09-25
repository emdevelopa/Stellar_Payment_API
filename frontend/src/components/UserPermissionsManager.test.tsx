import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { UserPermissionsManager } from "./UserPermissionsManager";
import { usePermissionsStore } from "@/hooks/usePermissionsStore";
import { toast } from "sonner";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const basePermissions = [
  { id: "payment-read", name: "View Payments", description: "View all payments", granted: true, category: "payment" as const },
  { id: "payment-write", name: "Create Payments", description: "Create new payments", granted: false, category: "payment" as const },
  { id: "webhook-read", name: "View Webhooks", description: "View webhook configurations", granted: true, category: "webhook" as const },
  { id: "webhook-write", name: "Manage Webhooks", description: "Create and modify webhooks", granted: false, category: "webhook" as const },
  { id: "analytics-read", name: "View Analytics", description: "View analytics data", granted: true, category: "analytics" as const },
  { id: "admin-access", name: "Admin Access", description: "Full system administration", granted: false, category: "admin" as const },
];

describe("UserPermissionsManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePermissionsStore.setState({ permissions: basePermissions, isHydrated: true });
  });

  it("renders manager region and permissions", () => {
    render(<UserPermissionsManager userId="u1" showCategories={false} />);

    expect(screen.getByRole("region", { name: "manager" })).toBeInTheDocument();
    expect(screen.getByLabelText("Create Payments")).toBeInTheDocument();
  });

  it("optimistically updates checkbox state and calls onPermissionsChange", async () => {
    const onPermissionsChange = vi.fn().mockResolvedValue(undefined);
    render(
      <UserPermissionsManager
        userId="u1"
        showCategories={false}
        onPermissionsChange={onPermissionsChange}
      />
    );

    const checkbox = screen.getByLabelText("Create Payments") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    await userEvent.click(checkbox);

    expect((screen.getByLabelText("Create Payments") as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(onPermissionsChange).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalled();
  });

  it("reverts optimistic update when callback fails", async () => {
    const onPermissionsChange = vi.fn().mockRejectedValue(new Error("fail"));
    render(
      <UserPermissionsManager
        userId="u1"
        showCategories={false}
        onPermissionsChange={onPermissionsChange}
      />
    );

    const checkbox = screen.getByLabelText("Create Payments") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    await userEvent.click(checkbox);

    await waitFor(() => {
      expect(onPermissionsChange).toHaveBeenCalledTimes(1);
      expect((screen.getByLabelText("Create Payments") as HTMLInputElement).checked).toBe(false);
    });
    expect(toast.error).toHaveBeenCalled();
  });

  it("disables permission controls in read-only mode", () => {
    render(<UserPermissionsManager userId="u1" showCategories={false} isReadOnly />);

    const checkbox = screen.getByLabelText("Create Payments") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    expect(screen.getByText("readOnlyNotice")).toBeInTheDocument();
  });

  it("adds accessible grouping metadata for category sections", async () => {
    render(<UserPermissionsManager userId="u1" showCategories />);

    const toggle = screen.getByRole("button", { name: /category.payment/i });
    expect(toggle).toHaveAttribute("aria-controls", "category-payment");

    const region = screen.getByRole("region", { name: /category.payment/i });
    expect(region).toHaveAttribute("id", "category-payment");
  });
});
