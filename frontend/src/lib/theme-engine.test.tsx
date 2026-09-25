/**
 * Unit tests for the Dark Mode Theme Engine (issue #800).
 *
 * Self-contained and jsdom-compatible: it provides a controllable `matchMedia`
 * mock and uses the real jsdom `document`/`localStorage`, so React Testing
 * Library's `render` works against a real DOM root.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ThemeProvider,
  useThemeState,
  useThemeActions,
  resolveTheme,
} from "./theme-context";

function mockMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: prefersDark,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function Consumer() {
  const { theme, resolvedTheme, isMounted, isDark, isLight, isSystem } = useThemeState();
  const { setTheme, toggleTheme } = useThemeActions();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <span data-testid="mounted">{String(isMounted)}</span>
      <span data-testid="isDark">{String(isDark)}</span>
      <span data-testid="isLight">{String(isLight)}</span>
      <span data-testid="isSystem">{String(isSystem)}</span>
      <button onClick={() => setTheme("dark")}>set-dark</button>
      <button onClick={() => setTheme("light")}>set-light</button>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  );
}

const renderEngine = () =>
  render(
    <ThemeProvider>
      <Consumer />
    </ThemeProvider>,
  );

describe("Dark Mode Theme Engine (#800)", () => {
  beforeEach(() => {
    mockMatchMedia(false);
    localStorage.clear();
    document.documentElement.className = "";
  });

  describe("resolveTheme helper", () => {
    it("resolves explicit light/dark modes verbatim", () => {
      expect(resolveTheme("light")).toBe("light");
      expect(resolveTheme("dark")).toBe("dark");
    });

    it("honors a forced theme over the requested mode", () => {
      expect(resolveTheme("light", "dark")).toBe("dark");
      expect(resolveTheme("system", "light")).toBe("light");
    });

    it("resolves system mode from the OS preference", () => {
      mockMatchMedia(true);
      expect(resolveTheme("system")).toBe("dark");
      mockMatchMedia(false);
      expect(resolveTheme("system")).toBe("light");
    });
  });

  it("applies the dark class and persists the preference when set to dark", async () => {
    renderEngine();
    await waitFor(() => expect(screen.getByTestId("mounted")).toHaveTextContent("true"));

    fireEvent.click(screen.getByText("set-dark"));

    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
      expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("merchant-theme-preference")).toBe("dark");
  });

  it("swaps the document class from dark to light", async () => {
    renderEngine();
    await waitFor(() => expect(screen.getByTestId("mounted")).toHaveTextContent("true"));

    fireEvent.click(screen.getByText("set-dark"));
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));

    fireEvent.click(screen.getByText("set-light"));
    await waitFor(() => {
      expect(document.documentElement.classList.contains("light")).toBe(true);
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  it("exposes correct derived flags via useThemeState", async () => {
    renderEngine();
    await waitFor(() => expect(screen.getByTestId("mounted")).toHaveTextContent("true"));

    fireEvent.click(screen.getByText("set-dark"));
    await waitFor(() => {
      expect(screen.getByTestId("isDark")).toHaveTextContent("true");
      expect(screen.getByTestId("isLight")).toHaveTextContent("false");
      expect(screen.getByTestId("isSystem")).toHaveTextContent("false");
    });
  });

  it("cycles light -> dark -> system via toggleTheme", async () => {
    renderEngine();
    await waitFor(() => expect(screen.getByTestId("mounted")).toHaveTextContent("true"));

    // Default is system; first toggle lands on light.
    fireEvent.click(screen.getByText("toggle"));
    await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("light"));

    fireEvent.click(screen.getByText("toggle"));
    await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("dark"));

    fireEvent.click(screen.getByText("toggle"));
    await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("system"));
  });

  describe("Optimistic updates", () => {
    it("applies optimistic UI update before persistence completes", () => {
      renderEngine();
      fireEvent.click(screen.getByText("set-dark"));
      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
      expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    });

    it("rolls back to previous theme when storage fails", async () => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = vi.fn(() => { throw new Error("Storage error"); });

      renderEngine();
      await waitFor(() => expect(screen.getByTestId("mounted")).toHaveTextContent("true"));

      fireEvent.click(screen.getByText("set-dark"));

      await waitFor(() => {
        expect(screen.getByTestId("theme")).toHaveTextContent("system");
      });

      Storage.prototype.setItem = orig;
    });

    it("persists theme on successful storage", async () => {
      renderEngine();
      await waitFor(() => expect(screen.getByTestId("mounted")).toHaveTextContent("true"));

      fireEvent.click(screen.getByText("set-dark"));

      await waitFor(() => {
        expect(localStorage.getItem("merchant-theme-preference")).toBe("dark");
      });
    });
  });
});
