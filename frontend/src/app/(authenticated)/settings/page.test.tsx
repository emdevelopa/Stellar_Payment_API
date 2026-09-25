/**
 * Unit tests for Settings Dashboard — Issue #984
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
// Import the client widget directly so the test bypasses the RSC wrapper (#1180/#1190)
import SettingsWidget from "./SettingsWidget";
import * as merchantStore from "@/lib/merchant-store";
import * as displayPreferences from "@/lib/display-preferences";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${Object.values(params).join(" ")}` : key,
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("react-dropzone", () => ({
  useDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    isDragActive: false,
  }),
}));

vi.mock("next/image", () => ({
  default: ({ src, alt, ...p }: any) => <img src={src} alt={alt} {...p} />,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...p }: any) => (
    <a href={href} {...p}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/CopyButton", () => ({
  default: ({ text }: any) => <button aria-label="Copy">{text}</button>,
}));
vi.mock("@/components/WebhookHealthIndicator", () => ({
  default: () => <div data-testid="webhook-health" />,
}));
vi.mock("@/components/DangerZone", () => ({
  default: () => <div data-testid="danger-zone" />,
}));
vi.mock("@/components/EmailReceiptPreview", () => ({
  EmailReceiptPreview: () => null,
}));
vi.mock("@/components/UserPermissionsManager", () => ({
  default: () => <div data-testid="permissions-manager" />,
}));
vi.mock("@/lib/merchant-store");
vi.mock("@/lib/display-preferences");

global.fetch = vi.fn();

const mockBrandingResponse = {
  ok: true,
  json: async () => ({
    branding_config: {
      primary_color: "#5ef2c0",
      secondary_color: "#b8ffe2",
      background_color: "#050608",
      logo_url: null,
    },
  }),
};

const mockWebhookResponse = {
  ok: true,
  json: async () => ({
    webhook_url: "https://example.com/hooks",
    webhook_secret_masked: "whsec_****",
    webhook_domain_verification: null,
  }),
};

function setupMocks(apiKey = "sk_test_key") {
  vi.mocked(merchantStore).useMerchantApiKey = vi.fn(() => apiKey);
  vi.mocked(merchantStore).useMerchantHydrated = vi.fn(() => true);
  vi.mocked(merchantStore).useSetMerchantApiKey = vi.fn(() => vi.fn());
  vi.mocked(merchantStore).useHydrateMerchantStore = vi.fn();
  vi.mocked(displayPreferences).useDisplayPreferences = vi.fn(() => ({
    hideCents: false,
    setHideCents: vi.fn(),
  }));
  (global.fetch as any).mockImplementation((url: string) => {
    if (url.includes("merchant-branding")) return Promise.resolve(mockBrandingResponse);
    if (url.includes("webhook-settings")) return Promise.resolve(mockWebhookResponse);
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("SettingsWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  describe("Rendering", () => {
    it("renders the page heading", async () => {
      render(<SettingsWidget />);
      await waitFor(() => expect(screen.getByText("title")).toBeInTheDocument());
    });

    it("renders all nav tabs", async () => {
      render(<SettingsWidget />);
      const labels = [
        "navApiKeys",
        "navBranding",
        "navDisplay",
        "navWebhooks",
        "navPermissions",
        "navDanger",
      ];
      await waitFor(() => {
        for (const label of labels) {
          expect(screen.getAllByText(label).length).toBeGreaterThan(0);
        }
      });
    });

    it("shows API Keys panel by default", async () => {
      render(<SettingsWidget />);
      await waitFor(() =>
        expect(screen.getByText("apiAuthTitle")).toBeInTheDocument()
      );
    });

    it("shows no-API-key message when apiKey is absent", () => {
      vi.mocked(merchantStore).useMerchantApiKey = vi.fn(() => null);
      render(<SettingsWidget />);
      expect(screen.getByText("noApiKeyTitle")).toBeInTheDocument();
    });

    it("shows a busy loading skeleton while store is not hydrated", () => {
      vi.mocked(merchantStore).useMerchantHydrated = vi.fn(() => false);
      const { container } = render(<SettingsWidget />);
      expect(container.firstChild).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status")).toHaveTextContent("loadingSettings");
    });
  });

  // ── Tab navigation ────────────────────────────────────────────────────────

  describe("Tab navigation", () => {
    it("switches to Branding panel on click", async () => {
      const user = userEvent.setup();
      render(<SettingsWidget />);
      const tabs = screen.getAllByRole("tab", { name: "navBranding" });
      await user.click(tabs[0]);
      await waitFor(() =>
        expect(screen.getByText("checkoutBrandingTitle")).toBeInTheDocument()
      );
    });

    it("switches to Display panel on click", async () => {
      const user = userEvent.setup();
      render(<SettingsWidget />);
      const tabs = screen.getAllByRole("tab", { name: "navDisplay" });
      await user.click(tabs[0]);
      await waitFor(() =>
        expect(screen.getByText("displayPreferencesTitle")).toBeInTheDocument()
      );
    });

    it("switches to Webhooks panel on click", async () => {
      const user = userEvent.setup();
      render(<SettingsWidget />);
      const tabs = screen.getAllByRole("tab", { name: "navWebhooks" });
      await user.click(tabs[0]);
      await waitFor(() =>
        expect(screen.getByText("webhookEndpointTitle")).toBeInTheDocument()
      );
    });

    it("switches to Permissions panel on click", async () => {
      const user = userEvent.setup();
      render(<SettingsWidget />);
      const tabs = screen.getAllByRole("tab", { name: "navPermissions" });
      await user.click(tabs[0]);
      await waitFor(() =>
        expect(screen.getByTestId("permissions-manager")).toBeInTheDocument()
      );
    });

    it("switches to Danger Zone panel on click", async () => {
      const user = userEvent.setup();
      render(<SettingsWidget />);
      const tabs = screen.getAllByRole("tab", { name: "navDanger" });
      await user.click(tabs[0]);
      await waitFor(() =>
        expect(screen.getByTestId("danger-zone")).toBeInTheDocument()
      );
    });
  });

  // ── API Keys tab ──────────────────────────────────────────────────────────

  describe("API Keys tab", () => {
    it("reveals API key on button click", async () => {
      const user = userEvent.setup();
      render(<SettingsWidget />);
      await waitFor(() => screen.getByText("apiAuthTitle"));

      const revealBtn = screen.getByRole("button", { name: /reveal/i });
      await user.click(revealBtn);
      expect(screen.getByRole("button", { name: /hide/i })).toBeInTheDocument();
    });

    it("shows rotate key confirmation flow", async () => {
      const user = userEvent.setup();
      render(<SettingsWidget />);
      await waitFor(() => screen.getByText("apiAuthTitle"));

      await user.click(screen.getByRole("button", { name: /rotateKeyEllipsis/i }));
      expect(screen.getByText("confirmAction")).toBeInTheDocument();
    });

    it("cancels rotation when Cancel clicked", async () => {
      const user = userEvent.setup();
      render(<SettingsWidget />);
      await waitFor(() => screen.getByText("apiAuthTitle"));

      await user.click(screen.getByRole("button", { name: /rotateKeyEllipsis/i }));
      await user.click(screen.getByRole("button", { name: /^cancel$/i }));
      expect(screen.queryByText("confirmAction")).not.toBeInTheDocument();
    });

    it("calls rotate-key API on confirm", async () => {
      const user = userEvent.setup();
      (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes("merchant-branding")) return Promise.resolve(mockBrandingResponse);
        if (url.includes("webhook-settings")) return Promise.resolve(mockWebhookResponse);
        if (url.includes("rotate-key"))
          return Promise.resolve({ ok: true, json: async () => ({ api_key: "sk_new_key" }) });
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      render(<SettingsWidget />);
      await waitFor(() => screen.getByText("apiAuthTitle"));

      await user.click(screen.getByRole("button", { name: /rotateKeyEllipsis/i }));
      await user.click(screen.getByRole("button", { name: /^confirm$/i }));

      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/rotate-key"),
          expect.objectContaining({ method: "POST" })
        )
      );
    });
  });

  // ── Branding tab ──────────────────────────────────────────────────────────

  describe("Branding tab", () => {
    async function openBranding() {
      const user = userEvent.setup();
      render(<SettingsWidget />);
      await user.click(screen.getAllByRole("tab", { name: "navBranding" })[0]);
      await waitFor(() => screen.getByText("checkoutBrandingTitle"));
      return user;
    }

    it("renders color inputs", async () => {
      await openBranding();
      expect(screen.getByLabelText(/colorPickerLabel primary/i)).toBeInTheDocument();
    });

    it("calls save branding API", async () => {
      const user = await openBranding();
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ branding_config: {} }),
      });
      await user.click(screen.getByRole("button", { name: /saveBranding/i }));
      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("merchant-branding"),
          expect.objectContaining({ method: "PUT" })
        )
      );
    });
  });

  // ── Display tab ───────────────────────────────────────────────────────────

  describe("Display tab", () => {
    it("toggles hideCents checkbox", async () => {
      const setHideCents = vi.fn();
      vi.mocked(displayPreferences).useDisplayPreferences = vi.fn(() => ({
        hideCents: false,
        setHideCents,
      }));
      const user = userEvent.setup();
      render(<SettingsWidget />);
      await user.click(screen.getAllByRole("tab", { name: "navDisplay" })[0]);
      await waitFor(() => screen.getByText("hideTrailingCents"));

      await user.click(screen.getByRole("checkbox"));
      expect(setHideCents).toHaveBeenCalledWith(true);
    });
  });

  // ── Webhooks tab ──────────────────────────────────────────────────────────

  describe("Webhooks tab", () => {
    async function openWebhooks() {
      const user = userEvent.setup();
      render(<SettingsWidget />);
      await user.click(screen.getAllByRole("tab", { name: "navWebhooks" })[0]);
      await waitFor(() => screen.getByText("webhookEndpointTitle"));
      return user;
    }

    it("shows validation error for non-HTTPS URL", async () => {
      const user = await openWebhooks();
      await user.clear(screen.getByLabelText("endpointUrl"));
      await user.type(screen.getByLabelText("endpointUrl"), "http://example.com");
      expect(await screen.findByText("webhookUrlMustBeHttps")).toBeInTheDocument();
    });

    it("calls save webhook API", async () => {
      const user = await openWebhooks();
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ webhook_url: "https://example.com/hooks" }),
      });
      await user.clear(screen.getByLabelText("endpointUrl"));
      await user.type(screen.getByLabelText("endpointUrl"), "https://example.com/hooks");
      await user.click(screen.getByRole("button", { name: /saveUrl/i }));
      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("webhook-settings"),
          expect.objectContaining({ method: "PUT" })
        )
      );
    });
  });
});
