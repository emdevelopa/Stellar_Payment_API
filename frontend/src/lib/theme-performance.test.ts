import { validateThemeStorage, sanitizeThemeInput } from "./theme-performance";

describe("validateThemeStorage", () => {
  it("returns true for valid theme 'light'", () => {
    expect(validateThemeStorage("light")).toBe(true);
  });

  it("returns true for valid theme 'dark'", () => {
    expect(validateThemeStorage("dark")).toBe(true);
  });

  it("returns true for valid theme 'system'", () => {
    expect(validateThemeStorage("system")).toBe(true);
  });

  it("returns false for invalid theme string", () => {
    expect(validateThemeStorage("invalid")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(validateThemeStorage("")).toBe(false);
  });

  it("returns false for non-string input", () => {
    expect(validateThemeStorage(123 as unknown as string)).toBe(false);
  });

  it("returns false for null input", () => {
    expect(validateThemeStorage(null as unknown as string)).toBe(false);
  });

  it("returns false for undefined input", () => {
    expect(validateThemeStorage(undefined as unknown as string)).toBe(false);
  });
});

describe("sanitizeThemeInput", () => {
  it("returns 'light' for 'Light' (case-insensitive)", () => {
    expect(sanitizeThemeInput("Light")).toBe("light");
  });

  it("returns 'dark' for '  DARK  ' (trimmed and lowercased)", () => {
    expect(sanitizeThemeInput("  DARK  ")).toBe("dark");
  });

  it("returns 'system' for 'SYSTEM' (case-insensitive)", () => {
    expect(sanitizeThemeInput("SYSTEM")).toBe("system");
  });

  it("returns null for invalid string input", () => {
    expect(sanitizeThemeInput("invalid")).toBe(null);
  });

  it("returns null for non-string input", () => {
    expect(sanitizeThemeInput(42)).toBe(null);
  });

  it("returns null for empty string", () => {
    expect(sanitizeThemeInput("")).toBe(null);
  });

  it("returns null for whitespace-only string", () => {
    expect(sanitizeThemeInput("   ")).toBe(null);
  });

  it("returns null for null input", () => {
    expect(sanitizeThemeInput(null)).toBe(null);
  });

  it("returns null for undefined input", () => {
    expect(sanitizeThemeInput(undefined)).toBe(null);
  });

  it("returns null for boolean input", () => {
    expect(sanitizeThemeInput(true as unknown as string)).toBe(null);
  });

  it("returns null for object input", () => {
    expect(sanitizeThemeInput({} as unknown as string)).toBe(null);
  });
});
