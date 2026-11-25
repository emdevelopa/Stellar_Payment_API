import { describe, it, expect, vi } from "vitest";
import {
  normalizeLanguage,
  escapeHtml,
  highlightCodeSnippet,
  loadLanguageGrammar,
} from "./dynamic-syntax-highlighter";

describe("dynamic-syntax-highlighter", () => {
  describe("normalizeLanguage", () => {
    it("normalizes javascript aliases", () => {
      expect(normalizeLanguage("js")).toBe("javascript");
      expect(normalizeLanguage("mjs")).toBe("javascript");
      expect(normalizeLanguage("language-javascript")).toBe("javascript");
      expect(normalizeLanguage("lang-js")).toBe("javascript");
    });

    it("normalizes typescript aliases", () => {
      expect(normalizeLanguage("ts")).toBe("typescript");
      expect(normalizeLanguage("language-ts")).toBe("typescript");
    });

    it("normalizes shell/bash aliases", () => {
      expect(normalizeLanguage("sh")).toBe("bash");
      expect(normalizeLanguage("shell")).toBe("bash");
      expect(normalizeLanguage("bash")).toBe("bash");
    });

    it("normalizes python aliases", () => {
      expect(normalizeLanguage("py")).toBe("python");
      expect(normalizeLanguage("python")).toBe("python");
    });

    it("defaults undefined or empty language to plain", () => {
      expect(normalizeLanguage(undefined)).toBe("plain");
      expect(normalizeLanguage("")).toBe("plain");
    });
  });

  describe("escapeHtml", () => {
    it("escapes special HTML characters safely", () => {
      const unsafe = `<script>alert("hello" & 'world')</script>`;
      const safe = escapeHtml(unsafe);
      expect(safe).not.toContain("<script>");
      expect(safe).toContain("&lt;script&gt;");
      expect(safe).toContain("&amp;");
      expect(safe).toContain("&quot;");
      expect(safe).toContain("&#039;");
    });
  });

  describe("highlightCodeSnippet", () => {
    it("returns empty string for empty code", async () => {
      const res = await highlightCodeSnippet("");
      expect(res).toBe("");
    });

    it("returns escaped HTML for plain text", async () => {
      const code = "<div>Simple Text</div>";
      const res = await highlightCodeSnippet(code, "plain");
      expect(res).toBe("&lt;div&gt;Simple Text&lt;/div&gt;");
    });

    it("dynamically imports and highlights JavaScript code", async () => {
      const jsCode = `const x = 42;`;
      const res = await highlightCodeSnippet(jsCode, "javascript");
      expect(res).toContain("token");
      expect(res).toContain("keyword");
      expect(res).toContain("number");
    });

    it("dynamically imports and highlights JSON code", async () => {
      const jsonCode = `{"status": "ok"}`;
      const res = await highlightCodeSnippet(jsonCode, "json");
      expect(res).toContain("token");
      expect(res).toContain("property");
    });

    it("falls back to escaped HTML on unknown language grammar without throwing", async () => {
      const customCode = `UNKNOWN LANGUAGE CODE`;
      const res = await highlightCodeSnippet(customCode, "non-existent-lang-xyz");
      expect(res).toBe("UNKNOWN LANGUAGE CODE");
    });
  });

  describe("loadLanguageGrammar", () => {
    it("returns true for plain/text", async () => {
      expect(await loadLanguageGrammar("plain")).toBe(true);
      expect(await loadLanguageGrammar("text")).toBe(true);
    });

    it("loads bash grammar dynamically", async () => {
      const loaded = await loadLanguageGrammar("bash");
      expect(loaded).toBe(true);
    });

    it("caches loaded languages", async () => {
      await loadLanguageGrammar("python");
      // Second call should return immediately from cache
      const cached = await loadLanguageGrammar("python");
      expect(cached).toBe(true);
    });
  });
});
