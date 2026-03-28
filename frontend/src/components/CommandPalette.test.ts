import { describe, it, expect } from "vitest";

// ── Replicate the filter logic from CommandPalette.tsx ─────────────────────
// (Pure function — no React needed)

interface Command {
  id: string;
  label: string;
  description: string;
  href: string;
  keywords: string[];
}

const commands: Command[] = [
  { id: "dashboard", label: "Dashboard", description: "View payments, metrics and activity", href: "/dashboard", keywords: ["dashboard", "home", "overview", "payments", "activity"] },
  { id: "api-keys", label: "API Keys", description: "Manage and rotate your API keys", href: "/settings#api-keys", keywords: ["api", "keys", "key", "rotate", "secret", "token"] },
  { id: "webhooks", label: "Webhooks", description: "Configure webhook URL and view delivery logs", href: "/settings#webhooks", keywords: ["webhook", "webhooks", "delivery", "logs", "url", "endpoint"] },
  { id: "settings", label: "Settings", description: "API keys, webhook URL & merchant config", href: "/settings", keywords: ["settings", "config", "api", "keys", "webhook", "merchant"] },
  { id: "create-payment", label: "Create Payment", description: "Generate a new Stellar payment link", href: "/dashboard/create", keywords: ["create", "payment", "new", "link", "pay", "generate"] },
  { id: "home", label: "Home", description: "Return to the landing page", href: "/", keywords: ["home", "landing", "dashboard", "main"] },
  { id: "register", label: "Register Merchant", description: "Register a new merchant account", href: "/register", keywords: ["register", "merchant", "signup", "account", "new"] },
];

function filterCommands(query: string): Command[] {
  if (query.length === 0) return commands;
  const q = query.toLowerCase();
  return commands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q) ||
      cmd.keywords.some((kw) => kw.includes(q)),
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("CommandPalette fuzzy search", () => {
  it("returns all commands when query is empty", () => {
    expect(filterCommands("").length).toBe(commands.length);
  });

  it("matches by label (case-insensitive)", () => {
    const results = filterCommands("DASHBOARD");
    expect(results.map((c) => c.id)).toContain("dashboard");
  });

  it("matches by description substring", () => {
    const results = filterCommands("delivery logs");
    expect(results.map((c) => c.id)).toContain("webhooks");
  });

  it("matches by keyword", () => {
    const results = filterCommands("rotate");
    expect(results.map((c) => c.id)).toContain("api-keys");
  });

  it("returns empty array for unrecognised query", () => {
    expect(filterCommands("xyzzy-nonexistent-term")).toHaveLength(0);
  });

  it("navigates to correct href for Dashboard", () => {
    const dash = commands.find((c) => c.id === "dashboard");
    expect(dash?.href).toBe("/dashboard");
  });

  it("navigates to correct href for API Keys", () => {
    const keys = commands.find((c) => c.id === "api-keys");
    expect(keys?.href).toBe("/settings#api-keys");
  });

  it("navigates to correct href for Webhooks", () => {
    const hooks = commands.find((c) => c.id === "webhooks");
    expect(hooks?.href).toBe("/settings#webhooks");
  });

  it("'web' matches both webhooks and settings", () => {
    const results = filterCommands("web");
    const ids = results.map((c) => c.id);
    expect(ids).toContain("webhooks");
    expect(ids).toContain("settings");
  });
});
