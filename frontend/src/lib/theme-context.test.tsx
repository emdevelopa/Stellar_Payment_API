import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider, useTheme, useThemeState, useThemeActions } from "./theme-context";

describe("Theme Context", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";

    // Replace localStorage with a plain mock object (jsdom's real Storage
    // instance doesn't allow its methods to be reassigned/mockImplemented
    // via vi.spyOn — property writes on it are silently no-ops), but only
    // spy on document/window rather than replacing them outright:
    // @testing-library/react's render() needs a real `document.body` to
    // mount into, which a full replacement object (as this suite
    // previously used for document too) doesn't have, breaking every test
    // that calls renderWithThemeProvider().
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    vi.spyOn(globalThis.window, "matchMedia").mockReturnValue({
      matches: false,
      // Both the legacy (addListener/removeListener, still used internally
      // by next-themes) and modern (addEventListener/removeEventListener,
      // used by this file's own ThemeProvider) MediaQueryList APIs are
      // mocked since ThemeProvider wraps children in next-themes'
      // <NextThemesProvider>, which calls matchMedia independently.
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);

    vi.spyOn(document.documentElement.classList, "remove");
    vi.spyOn(document.documentElement.classList, "add");
    vi.spyOn(document, "querySelector").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const TestComponent = () => {
    const { theme, resolvedTheme, setTheme, toggleTheme, isMounted, isLoading, error, clearError } = useTheme();
    
    return (
      <div>
        <div data-testid="theme">{theme}</div>
        <div data-testid="resolved-theme">{resolvedTheme}</div>
        <div data-testid="is-mounted">{isMounted.toString()}</div>
        <div data-testid="is-loading">{isLoading.toString()}</div>
        <div data-testid="error">{error || "no-error"}</div>
        <button onClick={() => setTheme("light")}>Set Light</button>
        <button onClick={() => setTheme("dark")}>Set Dark</button>
        <button onClick={() => setTheme("system")}>Set System</button>
        <button onClick={toggleTheme}>Toggle Theme</button>
        <button onClick={clearError}>Clear Error</button>
      </div>
    );
  };

  const renderWithThemeProvider = (props = {}) => {
    return render(
      <ThemeProvider {...props}>
        <TestComponent />
      </ThemeProvider>
    );
  };

  describe("Initialization", () => {
    it("initializes with default theme", async () => {
      // The pre-mount state (isMounted: false, isLoading: true) is real —
      // it's the reducer's initial state before the MOUNT effect dispatches
      // — but isn't observable via a synchronous assertion here: RTL's
      // render() flushes passive effects (via act()) before returning in
      // React 18, so is-mounted is already "true" by the time this line
      // would run. The meaningful assertion is the post-mount state below.
      renderWithThemeProvider();

      await waitFor(() => {
        expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
        expect(screen.getByTestId("is-loading")).toHaveTextContent("false");
      });
    });

    it("loads theme from localStorage", async () => {
      const mockGetItem = globalThis.localStorage.getItem as ReturnType<typeof vi.fn>;
      mockGetItem.mockReturnValue("dark");

      renderWithThemeProvider();

      await waitFor(() => {
        expect(screen.getByTestId("theme")).toHaveTextContent("dark");
        expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
      });
    });

    it("uses system preference when theme is system", async () => {
      const mockMatchMedia = globalThis.window.matchMedia as ReturnType<typeof vi.fn>;
      mockMatchMedia.mockReturnValue({
        matches: true,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      renderWithThemeProvider();

      await waitFor(() => {
        expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
      });
    });
  });

  describe("Theme Setting", () => {
    it("sets light theme correctly", async () => {
      renderWithThemeProvider();

      await waitFor(() => {
        expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
      });

      fireEvent.click(screen.getByText("Set Light"));

      await waitFor(() => {
        expect(screen.getByTestId("theme")).toHaveTextContent("light");
        expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");
      });

      expect(globalThis.localStorage.setItem).toHaveBeenCalledWith("merchant-theme-preference", "light");
      expect(globalThis.document.documentElement.classList.add).toHaveBeenCalledWith("light");
    });

    it("sets dark theme correctly", async () => {
      renderWithThemeProvider();

      await waitFor(() => {
        expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
      });

      fireEvent.click(screen.getByText("Set Dark"));

      await waitFor(() => {
        expect(screen.getByTestId("theme")).toHaveTextContent("dark");
        expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
      });

      expect(globalThis.localStorage.setItem).toHaveBeenCalledWith("merchant-theme-preference", "dark");
      expect(globalThis.document.documentElement.classList.add).toHaveBeenCalledWith("dark");
    });

    it("sets system theme correctly", async () => {
      renderWithThemeProvider();

      await waitFor(() => {
        expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
      });

      fireEvent.click(screen.getByText("Set System"));

      await waitFor(() => {
        expect(screen.getByTestId("theme")).toHaveTextContent("system");
      });
    });
  });

  describe("Theme Toggle", () => {
    it("toggles through themes in order", async () => {
      renderWithThemeProvider();

      await waitFor(() => {
        expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
      });

      fireEvent.click(screen.getByText("Toggle Theme"));
      await waitFor(() => {
        expect(screen.getByTestId("theme")).toHaveTextContent("light");
      });

      fireEvent.click(screen.getByText("Toggle Theme"));
      await waitFor(() => {
        expect(screen.getByTestId("theme")).toHaveTextContent("dark");
      });

      fireEvent.click(screen.getByText("Toggle Theme"));
      await waitFor(() => {
        expect(screen.getByTestId("theme")).toHaveTextContent("system");
      });
    });
  });

  describe("Error Handling", () => {
    it("handles localStorage errors gracefully and reverts optimistic updates", async () => {
      const mockSetItem = globalThis.localStorage.setItem as ReturnType<typeof vi.fn>;
      mockSetItem.mockImplementation(() => {
        throw new Error("Storage error");
      });

      renderWithThemeProvider({ defaultTheme: "system" });

      await waitFor(() => {
        expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
      });

      fireEvent.click(screen.getByText("Set Light"));

      await waitFor(() => {
        expect(screen.getByTestId("error")).toHaveTextContent("Storage error");
        expect(screen.getByTestId("theme")).toHaveTextContent("system");
      });
    });

    it("clears errors correctly", async () => {
      const mockSetItem = globalThis.localStorage.setItem as ReturnType<typeof vi.fn>;
      mockSetItem.mockImplementation(() => {
        throw new Error("Storage error");
      });

      renderWithThemeProvider();

      await waitFor(() => {
        expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
      });

      fireEvent.click(screen.getByText("Set Light"));

      await waitFor(() => {
        expect(screen.getByTestId("error")).toHaveTextContent("Storage error");
      });

      fireEvent.click(screen.getByText("Clear Error"));

      await waitFor(() => {
        expect(screen.getByTestId("error")).toHaveTextContent("no-error");
      });
    });
  });

  describe("System Theme Changes", () => {
    it("updates resolved theme when system preference changes", async () => {
      let mediaQueryCallback: ((e: MediaQueryListEvent) => void) | null = null;
      // Shared mutable state: the component re-queries matchMedia().matches
      // (via systemPrefersDark()) on every change event rather than trusting
      // the event's own `matches` field, so simulating "the OS preference
      // flipped to dark" requires the *next* matchMedia() call to also
      // return matches: true, not just the event object.
      let currentMatches = false;

      const mockMatchMedia = globalThis.window.matchMedia as ReturnType<typeof vi.fn>;
      mockMatchMedia.mockImplementation((query) => ({
        get matches() {
          return currentMatches;
        },
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((event, callback) => {
          if (event === "change") {
            mediaQueryCallback = callback as (e: MediaQueryListEvent) => void;
          }
        }),
        removeEventListener: vi.fn(),
      }));

      renderWithThemeProvider({ defaultTheme: "system" });

      await waitFor(() => {
        expect(screen.getByTestId("theme")).toHaveTextContent("system");
        expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");
      });

      if (mediaQueryCallback) {
        currentMatches = true;
        mediaQueryCallback({ matches: true } as MediaQueryListEvent);

        await waitFor(() => {
          expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
        });
      }
    });
  });
});

describe("useThemeState Hook", () => {
  it("provides theme state with computed values", async () => {
    const TestComponent = () => {
      const state = useThemeState();
      
      return (
        <div>
          <div data-testid="theme">{state.theme}</div>
          <div data-testid="resolved-theme">{state.resolvedTheme}</div>
          <div data-testid="is-dark">{state.isDark.toString()}</div>
          <div data-testid="is-light">{state.isLight.toString()}</div>
          <div data-testid="is-system">{state.isSystem.toString()}</div>
        </div>
      );
    };

    render(
      <ThemeProvider defaultTheme="dark">
        <TestComponent />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
      expect(screen.getByTestId("is-dark")).toHaveTextContent("true");
      expect(screen.getByTestId("is-light")).toHaveTextContent("false");
      expect(screen.getByTestId("is-system")).toHaveTextContent("false");
    });
  });
});

describe("useThemeActions Hook", () => {
  it("provides theme actions", async () => {
    const TestComponent = () => {
      const actions = useThemeActions();
      
      return (
        <div>
          <button onClick={() => actions.setTheme("light")}>Set Light</button>
          <button onClick={actions.toggleTheme}>Toggle</button>
          <button onClick={actions.clearError}>Clear Error</button>
        </div>
      );
    };

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByText("Set Light")).toBeInTheDocument();
    expect(screen.getByText("Toggle")).toBeInTheDocument();
    expect(screen.getByText("Clear Error")).toBeInTheDocument();
  });
});

describe("Dark Mode Theme Engine", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";

    // Replace localStorage with a plain mock object (jsdom's real Storage
    // instance doesn't allow its methods to be reassigned/mockImplemented
    // via vi.spyOn — property writes on it are silently no-ops), but only
    // spy on document/window rather than replacing them outright:
    // @testing-library/react's render() needs a real `document.body` to
    // mount into, which a full replacement object (as this suite
    // previously used for document too) doesn't have, breaking every test
    // that calls renderDarkMode().
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    vi.spyOn(globalThis.window, "matchMedia").mockReturnValue({
      matches: false,
      // Both the legacy (addListener/removeListener, still used internally
      // by next-themes) and modern (addEventListener/removeEventListener,
      // used by this file's own ThemeProvider) MediaQueryList APIs are
      // mocked since ThemeProvider wraps children in next-themes'
      // <NextThemesProvider>, which calls matchMedia independently.
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);

    vi.spyOn(document.documentElement.classList, "remove");
    vi.spyOn(document.documentElement.classList, "add");
    vi.spyOn(document, "querySelector").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const DarkModeTestComponent = () => {
    const { theme, resolvedTheme, setTheme, toggleTheme, isMounted, isLoading, error, clearError } = useTheme();

    return (
      <div>
        <div data-testid="theme">{theme}</div>
        <div data-testid="resolved-theme">{resolvedTheme}</div>
        <div data-testid="is-mounted">{isMounted.toString()}</div>
        <div data-testid="is-loading">{isLoading.toString()}</div>
        <div data-testid="error">{error || "no-error"}</div>
        <button onClick={() => setTheme("light")}>Set Light</button>
        <button onClick={() => setTheme("dark")}>Set Dark</button>
        <button onClick={() => setTheme("system")}>Set System</button>
        <button onClick={toggleTheme}>Toggle Theme</button>
        <button onClick={clearError}>Clear Error</button>
      </div>
    );
  };

  const renderDarkMode = (props = {}) => {
    return render(
      <ThemeProvider {...props}>
        <DarkModeTestComponent />
      </ThemeProvider>
    );
  };

  it("applies dark class to document element when dark theme is set", async () => {
    renderDarkMode({ defaultTheme: "light" });

    await waitFor(() => {
      expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByText("Set Dark"));

    await waitFor(() => {
      expect(globalThis.document.documentElement.classList.remove).toHaveBeenCalledWith("light", "dark");
      expect(globalThis.document.documentElement.classList.add).toHaveBeenCalledWith("dark");
    });
  });

  it("removes dark class and applies light class when switching from dark to light", async () => {
    renderDarkMode({ defaultTheme: "dark" });

    await waitFor(() => {
      expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByText("Set Light"));

    await waitFor(() => {
      expect(globalThis.document.documentElement.classList.remove).toHaveBeenCalledWith("light", "dark");
      expect(globalThis.document.documentElement.classList.add).toHaveBeenCalledWith("light");
    });
  });

  it("resolves system theme to dark when prefers-color-scheme is dark", async () => {
    const mockMatchMedia = globalThis.window.matchMedia as ReturnType<typeof vi.fn>;
    mockMatchMedia.mockReturnValue({
      matches: true,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    renderDarkMode({ defaultTheme: "system" });

    await waitFor(() => {
      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
    });
  });

  it("resolves system theme to light when prefers-color-scheme is light", async () => {
    const mockMatchMedia = globalThis.window.matchMedia as ReturnType<typeof vi.fn>;
    mockMatchMedia.mockReturnValue({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    renderDarkMode({ defaultTheme: "system" });

    await waitFor(() => {
      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");
    });
  });

  it("updates meta theme-color to dark value when theme is dark", async () => {
    const mockMeta = { setAttribute: vi.fn() };
    const mockQuerySelector = globalThis.document.querySelector as ReturnType<typeof vi.fn>;
    mockQuerySelector.mockReturnValue(mockMeta);

    renderDarkMode({ defaultTheme: "light" });

    await waitFor(() => {
      expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByText("Set Dark"));

    await waitFor(() => {
      expect(mockMeta.setAttribute).toHaveBeenCalledWith("content", "#0A0A0A");
    });
  });

  it("updates meta theme-color to light value when theme is light", async () => {
    const mockMeta = { setAttribute: vi.fn() };
    const mockQuerySelector = globalThis.document.querySelector as ReturnType<typeof vi.fn>;
    mockQuerySelector.mockReturnValue(mockMeta);

    renderDarkMode({ defaultTheme: "dark" });

    await waitFor(() => {
      expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByText("Set Light"));

    await waitFor(() => {
      expect(mockMeta.setAttribute).toHaveBeenCalledWith("content", "#FFFFFF");
    });
  });

  it("persists dark theme preference to localStorage", async () => {
    renderDarkMode({ defaultTheme: "light" });

    await waitFor(() => {
      expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByText("Set Dark"));

    await waitFor(() => {
      expect(globalThis.localStorage.setItem).toHaveBeenCalledWith("merchant-theme-preference", "dark");
    });
  });

  it("uses custom storageKey for dark theme persistence", async () => {
    renderDarkMode({ defaultTheme: "light", storageKey: "custom-theme-key" });

    await waitFor(() => {
      expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByText("Set Dark"));

    await waitFor(() => {
      expect(globalThis.localStorage.setItem).toHaveBeenCalledWith("custom-theme-key", "dark");
    });
  });

  it("supports forcedTheme override for dark mode", async () => {
    const mockMatchMedia = globalThis.window.matchMedia as ReturnType<typeof vi.fn>;
    mockMatchMedia.mockReturnValue({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    renderDarkMode({ defaultTheme: "system", forcedTheme: "dark" });

    await waitFor(() => {
      expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
    });
  });

  it("reverts to previous theme when dark mode setTheme fails", async () => {
    const mockSetItem = globalThis.localStorage.setItem as ReturnType<typeof vi.fn>;
    mockSetItem.mockImplementation(() => {
      throw new Error("Storage error");
    });

    renderDarkMode({ defaultTheme: "light" });

    await waitFor(() => {
      expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByText("Set Dark"));

    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent("Storage error");
      expect(screen.getByTestId("theme")).toHaveTextContent("light");
    });
  });

  it("optimistically updates the document class before localStorage persists", async () => {
    renderDarkMode({ defaultTheme: "light" });

    await waitFor(() => {
      expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByText("Set Dark"));

    await waitFor(() => {
      expect(globalThis.document.documentElement.classList.add).toHaveBeenCalledWith("dark");
      expect(globalThis.localStorage.setItem).toHaveBeenCalledWith("merchant-theme-preference", "dark");
    });

    const removeCallOrder = (globalThis.document.documentElement.classList.remove as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const addCallOrder = (globalThis.document.documentElement.classList.add as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const storageCallOrder = (globalThis.localStorage.setItem as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];

    expect(addCallOrder).toBeLessThan(storageCallOrder);
  });

  it("applies document class update on rollback when persist fails", async () => {
    const mockSetItem = globalThis.localStorage.setItem as ReturnType<typeof vi.fn>;
    mockSetItem.mockImplementation(() => {
      throw new Error("Storage error");
    });

    renderDarkMode({ defaultTheme: "light" });

    await waitFor(() => {
      expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByText("Set Dark"));

    await waitFor(() => {
      expect(globalThis.document.documentElement.classList.add).toHaveBeenCalledWith("light");
      expect(screen.getByTestId("error")).toHaveTextContent("Storage error");
    });
  });

  it("sets error and maintains current theme when localStorage.setItem throws after multiple toggles", async () => {
    const mockSetItem = globalThis.localStorage.setItem as ReturnType<typeof vi.fn>;
    let failNext = false;
    mockSetItem.mockImplementation((key: string, value: string) => {
      if (failNext) {
        throw new Error("Storage full");
      }
    });

    renderDarkMode({ defaultTheme: "light" });

    await waitFor(() => {
      expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByText("Set Dark"));
    await waitFor(() => {
      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    });

    failNext = true;
    fireEvent.click(screen.getByText("Set Light"));

    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent("Storage full");
      expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    });
  });

  it("clears error on successful theme set after a failure", async () => {
    const mockSetItem = globalThis.localStorage.setItem as ReturnType<typeof vi.fn>;
    let shouldFail = true;
    mockSetItem.mockImplementation(() => {
      if (shouldFail) {
        throw new Error("Temporary error");
      }
    });

    renderDarkMode({ defaultTheme: "light" });

    await waitFor(() => {
      expect(screen.getByTestId("is-mounted")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByText("Set Dark"));

    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent("Temporary error");
    });

    shouldFail = false;
    fireEvent.click(screen.getByText("Set Light"));

    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent("no-error");
      expect(screen.getByTestId("theme")).toHaveTextContent("light");
    });
  });
});

describe("Error Cases", () => {
  it("throws error when useTheme is used outside ThemeProvider", () => {
    const TestComponent = () => {
      useTheme();
      return <div>Test</div>;
    };

    expect(() => {
      render(<TestComponent />);
    }).toThrow("useTheme must be used within a ThemeProvider");
  });
});
