import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider, useTheme, useThemeState, useThemeActions } from "./theme-context";

describe("Theme Context", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";

    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
    });

    Object.defineProperty(globalThis, "window", {
      value: {
        matchMedia: vi.fn(() => ({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      },
      writable: true,
    });

    Object.defineProperty(globalThis, "document", {
      value: {
        documentElement: {
          classList: {
            remove: vi.fn(),
            add: vi.fn(),
          },
        },
        querySelector: vi.fn(() => null),
      },
      writable: true,
    });
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
      renderWithThemeProvider();
      
      expect(screen.getByTestId("is-mounted")).toHaveTextContent("false");
      expect(screen.getByTestId("is-loading")).toHaveTextContent("true");
      
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
      
      const mockMatchMedia = globalThis.window.matchMedia as ReturnType<typeof vi.fn>;
      mockMatchMedia.mockImplementation((query) => ({
        matches: false,
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

    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
    });

    Object.defineProperty(globalThis, "window", {
      value: {
        matchMedia: vi.fn(() => ({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      },
      writable: true,
    });

    Object.defineProperty(globalThis, "document", {
      value: {
        documentElement: {
          classList: {
            remove: vi.fn(),
            add: vi.fn(),
          },
        },
        querySelector: vi.fn(() => null),
      },
      writable: true,
    });
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
    let callCount = 0;
    mockSetItem.mockImplementation(() => {
      callCount++;
      if (callCount > 1) {
        throw new Error("Storage error");
      }
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
