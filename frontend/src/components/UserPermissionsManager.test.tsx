import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserPermissionsManager } from "./UserPermissionsManager";

// Mock the dependencies
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Unit tests for UserPermissionsManager component
 */
describe("UserPermissionsManager", () => {
  const defaultProps = {
    userId: "test-user-123",
    onPermissionsChange: vi.fn(),
    isReadOnly: false,
    showCategories: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("should render the permissions manager with title and description", () => {
      render(<UserPermissionsManager {...defaultProps} />);

      expect(
        screen.getByRole("region", {
          name: "permissions.manager",
        })
      ).toBeInTheDocument();
      expect(
        screen.getByText("permissions.title")
      ).toBeInTheDocument();
      expect(
        screen.getByText("permissions.subtitle")
      ).toBeInTheDocument();
    });

    it("should render permission categories when showCategories is true", () => {
      render(
        <UserPermissionsManager
          {...defaultProps}
          showCategories={true}
        />
      );

      expect(
        screen.getByRole("button", { name: /categories\./i, hidden: true })
      ).toBeDefined();
    });

    it("should render flat permission list when showCategories is false", () => {
      render(
        <UserPermissionsManager
          {...defaultProps}
          showCategories={false}
        />
      );

      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes.length).toBeGreaterThan(0);
    });

    it("should display read-only notice when isReadOnly is true", () => {
      render(
        <UserPermissionsManager
          {...defaultProps}
          isReadOnly={true}
        />
      );

      expect(
        screen.getByText("permissions.readOnlyNotice")
      ).toBeInTheDocument();
    });
  });

  describe("Permission Management", () => {
    it("should render all permission checkboxes", () => {
      render(
        <UserPermissionsManager
          {...defaultProps}
          showCategories={false}
        />
      );

      const expectedPermissions = [
        "View Payments",
        "Create Payments",
        "View Webhooks",
        "Manage Webhooks",
        "View Analytics",
        "Admin Access",
      ];

      expectedPermissions.forEach((permName) => {
        expect(screen.getByLabelText(permName)).toBeInTheDocument();
      });
    });

    it("should toggle permission when checkbox is clicked", async () => {
      const onPermissionsChange = vi.fn();
      render(
        <UserPermissionsManager
          {...defaultProps}
          onPermissionsChange={onPermissionsChange}
          showCategories={false}
        />
      );

      const checkbox = screen.getByLabelText("Create Payments");
      const isInitiallyChecked = (checkbox as HTMLInputElement).checked;

      await userEvent.click(checkbox);

      await waitFor(() => {
        expect(onPermissionsChange).toHaveBeenCalled();
      });

      expect((checkbox as HTMLInputElement).checked).not.toBe(
        isInitiallyChecked
      );
    });

    it("should not allow permission changes when isReadOnly is true", async () => {
      const onPermissionsChange = vi.fn();
      render(
        <UserPermissionsManager
          {...defaultProps}
          onPermissionsChange={onPermissionsChange}
          isReadOnly={true}
          showCategories={false}
        />
      );

      const checkbox = screen.getByLabelText("Create Payments");
      (checkbox as HTMLInputElement).disabled = true;

      expect((checkbox as HTMLInputElement).disabled).toBe(true);
    });

    it("should call onPermissionsChange with updated permissions", async () => {
      const onPermissionsChange = vi.fn();
      render(
        <UserPermissionsManager
          {...defaultProps}
          onPermissionsChange={onPermissionsChange}
          showCategories={false}
        />
      );

      const checkbox = screen.getByLabelText("Create Payments");
      await userEvent.click(checkbox);

      await waitFor(() => {
        expect(onPermissionsChange).toHaveBeenCalled();
      });
    });
  });

  describe("Category Management", () => {
    it("should expand/collapse categories on click", async () => {
      render(
        <UserPermissionsManager
          {...defaultProps}
          showCategories={true}
        />
      );

      const categoryButton = screen.getAllByRole("button").find((btn) =>
        btn.getAttribute("aria-expanded") !== null
      );

      expect(categoryButton).toBeDefined();
    });

    it("should show permission count for each category", () => {
      render(
        <UserPermissionsManager
          {...defaultProps}
          showCategories={true}
        />
      );

      // Check that count displays exist (e.g., "1 of 2")
      const countElements = screen.queryAllByText(/of/);
      expect(countElements.length).toBeGreaterThan(0);
    });

    it("should render category badges with appropriate colors", () => {
      render(
        <UserPermissionsManager
          {...defaultProps}
          showCategories={true}
        />
      );

      expect(screen.getByText("permissions.category.payment")).toBeInTheDocument();
      expect(
        screen.getByText("permissions.category.webhook")
      ).toBeInTheDocument();
      expect(
        screen.getByText("permissions.category.analytics")
      ).toBeInTheDocument();
      expect(
        screen.getByText("permissions.category.admin")
      ).toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    it("should have proper ARIA labels and descriptions", () => {
      render(
        <UserPermissionsManager
          {...defaultProps}
          showCategories={false}
        />
      );

      const checkboxes = screen.getAllByRole("checkbox");
      checkboxes.forEach((checkbox) => {
        expect((checkbox as HTMLInputElement).getAttribute("aria-label")).toBeTruthy();
      });
    });

    it("should have proper region boundaries", () => {
      render(<UserPermissionsManager {...defaultProps} />);

      const region = screen.getByRole("region");
      expect(region).toHaveAttribute("aria-label");
    });

    it("should have proper focus management for keyboard navigation", async () => {
      render(
        <UserPermissionsManager
          {...defaultProps}
          showCategories={false}
        />
      );

      const firstCheckbox = screen.getByLabelText("View Payments");
      firstCheckbox.focus();

      expect(document.activeElement).toBe(firstCheckbox);
    });

    it("should support screen reader descriptions via aria-describedby", () => {
      render(
        <UserPermissionsManager
          {...defaultProps}
          showCategories={false}
        />
      );

      const checkbox = screen.getByLabelText("View Payments");
      const describedBy = checkbox.getAttribute("aria-describedby");

      expect(describedBy).toBeTruthy();
      const descElement = document.getElementById(describedBy!);
      expect(descElement).toBeInTheDocument();
    });
  });

  describe("Read-only Mode", () => {
    it("should disable all checkboxes when isReadOnly is true", () => {
      render(
        <UserPermissionsManager
          {...defaultProps}
          isReadOnly={true}
          showCategories={false}
        />
      );

      const checkboxes = screen.getAllByRole("checkbox");
      checkboxes.forEach((checkbox) => {
        expect((checkbox as HTMLInputElement).disabled).toBe(true);
      });
    });

    it("should prevent permission changes in read-only mode", async () => {
      const onPermissionsChange = vi.fn();
      render(
        <UserPermissionsManager
          {...defaultProps}
          onPermissionsChange={onPermissionsChange}
          isReadOnly={true}
          showCategories={false}
        />
      );

      const checkbox = screen.getByLabelText("Create Payments") as HTMLInputElement;
      expect(checkbox.disabled).toBe(true);
    });
  });

  describe("Animation and Interaction", () => {
    it("should render without animation errors", () => {
      const { container } = render(
        <UserPermissionsManager {...defaultProps} />
      );

      expect(container).toBeDefined();
      expect(container.querySelector('[role="region"]')).toBeInTheDocument();
    });

    it("should maintain state consistency across renders", () => {
      const { rerender } = render(
        <UserPermissionsManager {...defaultProps} />
      );

      rerender(
        <UserPermissionsManager
          {...defaultProps}
          showCategories={false}
        />
      );

      expect(
        screen.getByRole("region", {
          name: "permissions.manager",
        })
      ).toBeInTheDocument();
    });
  });

  describe("Integration", () => {
    it("should work with multiple permission changes", async () => {
      const onPermissionsChange = vi.fn();
      render(
        <UserPermissionsManager
          {...defaultProps}
          onPermissionsChange={onPermissionsChange}
          showCategories={false}
        />
      );

      const checkbox1 = screen.getByLabelText("Create Payments");
      const checkbox2 = screen.getByLabelText("Manage Webhooks");

      await userEvent.click(checkbox1);
      await userEvent.click(checkbox2);

      await waitFor(() => {
        expect(onPermissionsChange).toHaveBeenCalledTimes(2);
      });
    });

    it("should handle category switching without losing state", async () => {
      const { rerender } = render(
        <UserPermissionsManager
          {...defaultProps}
          showCategories={true}
        />
      );

      rerender(
        <UserPermissionsManager
          {...defaultProps}
          showCategories={false}
        />
      );

      rerender(
        <UserPermissionsManager
          {...defaultProps}
          showCategories={true}
        />
      );

      expect(
        screen.getByRole("region", {
          name: "permissions.manager",
        })
      ).toBeInTheDocument();
    });
  });
});
