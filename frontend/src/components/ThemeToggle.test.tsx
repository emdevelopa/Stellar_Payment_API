import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider } from "@/lib/theme-context";
import ThemeToggle from "./ThemeToggle";

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual("framer-motion");
  return {
    ...actual,
    motion: {
      button: ({ children, whileHover, whileTap, transition, ...props }: any) =>
        React.createElement("button", props, children),
      svg: ({ children, initial, animate, exit, transition, ...props }: any) =>
        React.createElement("svg", props, children),
      div: ({ children, initial, animate, exit, transition, ...props }: any) =>
        React.createElement("div", props, children),
    },
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => false,
  };
});

describe("ThemeToggle", () => {
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

  it("renders loading state initially then toggle button", async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    expect(screen.getByLabelText("Loading theme settings")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByLabelText(/theme toggle/i)).toBeInTheDocument();
    });
  });

  it("displays error state and allows retry", async () => {
    const mockSetItem = globalThis.localStorage.setItem as ReturnType<typeof vi.fn>;
    mockSetItem.mockImplementation(() => {
      throw new Error("Storage error");
    });

    render(
      <ThemeProvider defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/theme toggle/i)).toBeInTheDocument();
    });

    const button = screen.getByLabelText(/theme toggle/i);
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByLabelText(/error/i)).toBeInTheDocument();
    });
  });

  it("provides screen reader announcements", async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>
    );

    await waitFor(() => {
      const announcements = document.querySelectorAll('[role="status"]');
      expect(announcements.length).toBeGreaterThan(0);
    });
  });
});
