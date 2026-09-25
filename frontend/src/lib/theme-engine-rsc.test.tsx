import { describe, it, expect } from "vitest";
import { getInitialThemeMetadata } from "./theme-engine-rsc";

describe("theme-engine-rsc", () => {
  describe("getInitialThemeMetadata", () => {
    it("returns default theme metadata", () => {
      const metadata = getInitialThemeMetadata();
      expect(metadata.theme).toBe("system");
      expect(metadata.resolvedTheme).toBe("light");
      expect(metadata.colorScheme).toBe("light");
    });

    it("respects custom default theme", () => {
      const metadata = getInitialThemeMetadata("dark");
      expect(metadata.theme).toBe("dark");
      expect(metadata.resolvedTheme).toBe("light");
    });

    it("respects forced theme", () => {
      const metadata = getInitialThemeMetadata("system", "dark");
      expect(metadata.theme).toBe("system");
      expect(metadata.resolvedTheme).toBe("dark");
      expect(metadata.colorScheme).toBe("dark");
    });

    it("returns correct color-scheme value", () => {
      const metadata = getInitialThemeMetadata("light");
      expect(metadata.colorScheme).toBe("light");
    });
  });
});
