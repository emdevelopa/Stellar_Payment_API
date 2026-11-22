/**
 * Dynamic Syntax Highlighter utility
 *
 * Implements code splitting and bundle footprint optimization (#1812)
 * by dynamically importing Prism.js core and language grammars on demand.
 */

import { useEffect, useState } from "react";

const loadedLanguages = new Set<string>();

/**
 * Normalizes common language aliases to Prism grammar names.
 */
export function normalizeLanguage(lang?: string): string {
  if (!lang) return "plain";
  const lower = lang.toLowerCase().trim();

  // Strip common prefixes like 'language-' or 'lang-'
  const clean = lower.replace(/^language-/, "").replace(/^lang-/, "");

  switch (clean) {
    case "js":
    case "javascript":
    case "mjs":
    case "cjs":
      return "javascript";
    case "ts":
    case "typescript":
      return "typescript";
    case "jsx":
      return "jsx";
    case "tsx":
      return "tsx";
    case "py":
    case "python":
      return "python";
    case "sh":
    case "bash":
    case "shell":
    case "zsh":
      return "bash";
    case "json":
      return "json";
    case "html":
    case "xml":
    case "svg":
      return "markup";
    case "css":
      return "css";
    case "yaml":
    case "yml":
      return "yaml";
    case "md":
    case "markdown":
      return "markdown";
    case "rs":
    case "rust":
      return "rust";
    case "go":
    case "golang":
      return "go";
    case "sql":
      return "sql";
    case "http":
      return "http";
    default:
      return clean;
  }
}

/**
 * Escapes HTML entities for safe fallback rendering.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Dynamically loads Prism grammar for the requested language.
 */
export async function loadLanguageGrammar(lang: string): Promise<boolean> {
  if (lang === "plain" || lang === "text" || loadedLanguages.has(lang)) {
    return true;
  }

  try {
    switch (lang) {
      case "bash":
        await import("prismjs/components/prism-bash");
        break;
      case "javascript":
        await import("prismjs/components/prism-javascript");
        break;
      case "typescript":
        await import("prismjs/components/prism-javascript");
        await import("prismjs/components/prism-typescript");
        break;
      case "jsx":
        await import("prismjs/components/prism-javascript");
        await import("prismjs/components/prism-jsx");
        break;
      case "tsx":
        await import("prismjs/components/prism-javascript");
        await import("prismjs/components/prism-typescript");
        await import("prismjs/components/prism-jsx");
        await import("prismjs/components/prism-tsx");
        break;
      case "python":
        await import("prismjs/components/prism-python");
        break;
      case "json":
        await import("prismjs/components/prism-json");
        break;
      case "yaml":
        await import("prismjs/components/prism-yaml");
        break;
      case "markdown":
        await import("prismjs/components/prism-markdown");
        break;
      case "rust":
        await import("prismjs/components/prism-rust");
        break;
      case "go":
        await import("prismjs/components/prism-go");
        break;
      case "sql":
        await import("prismjs/components/prism-sql");
        break;
      case "http":
        await import("prismjs/components/prism-http");
        break;
      default:
        // Try dynamic import by name if available
        try {
          // @ts-ignore dynamic prism import
          await import(`prismjs/components/prism-${lang}`);
        } catch {
          // Language grammar not available, fallback to plain
          return false;
        }
        break;
    }

    loadedLanguages.add(lang);
    return true;
  } catch {
    return false;
  }
}

/**
 * Highlights a code snippet asynchronously using dynamically imported Prism.js.
 */
export async function highlightCodeSnippet(
  code: string,
  rawLang?: string
): Promise<string> {
  if (!code) return "";

  const lang = normalizeLanguage(rawLang);

  if (lang === "plain" || lang === "text") {
    return escapeHtml(code);
  }

  try {
    const PrismModule: any = await import("prismjs");
    const Prism = PrismModule.default || PrismModule;

    // Ensure grammar is loaded
    await loadLanguageGrammar(lang);

    const grammar = Prism.languages[lang];
    if (grammar) {
      return Prism.highlight(code, grammar, lang);
    }
  } catch {
    // Graceful fallback to HTML escaped text
  }

  return escapeHtml(code);
}

/**
 * Hook for component-level code highlighting with dynamic imports and SSR fallback.
 */
export function useDynamicSyntaxHighlighter(
  code: string,
  language?: string
): {
  highlightedHtml: string | null;
  isLoading: boolean;
} {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    if (!code) {
      setHighlightedHtml("");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    highlightCodeSnippet(code, language)
      .then((html) => {
        if (!isCancelled) {
          setHighlightedHtml(html);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setHighlightedHtml(escapeHtml(code));
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [code, language]);

  return { highlightedHtml, isLoading };
}
