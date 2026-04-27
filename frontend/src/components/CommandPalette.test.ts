import { describe, expect, it } from "vitest";
import { filterPaletteCommands, paletteCommands } from "./commandPaletteData";

describe("Command palette data", () => {
  it("contains required quick actions", () => {
    const ids = paletteCommands.map((command) => command.id);
    expect(ids).toContain("create-new-payment");
    expect(ids).toContain("copy-api-key");
    expect(ids).toContain("toggle-theme");
  });

  it("contains required high-level navigation routes", () => {
    const commandById = new Map(paletteCommands.map((command) => [command.id, command]));

    expect(commandById.get("dashboard")?.href).toBe("/dashboard");
    expect(commandById.get("settings")?.href).toBe("/settings");
    expect(commandById.get("docs")?.href).toBe("/docs");
  });
});

describe("Command palette fuzzy search", () => {
  it("returns all commands when query is empty", () => {
    expect(filterPaletteCommands("")).toHaveLength(paletteCommands.length);
  });

  it("finds create payment with fuzzy query", () => {
    const results = filterPaletteCommands("crt pmt");
    expect(results.map((command) => command.id)).toContain("create-new-payment");
  });

  it("finds copy API key with fuzzy query", () => {
    const results = filterPaletteCommands("cpy key");
    expect(results.map((command) => command.id)).toContain("copy-api-key");
  });

  it("finds theme toggle with fuzzy query", () => {
    const results = filterPaletteCommands("tgle thm");
    expect(results.map((command) => command.id)).toContain("toggle-theme");
  });

  it("finds help topics", () => {
    const results = filterPaletteCommands("help hmac");
    expect(results.map((command) => command.id)).toContain("help-hmac-signatures");
  });

  it("returns docs as top result for docs query", () => {
    const results = filterPaletteCommands("docs");
    expect(results[0]?.id).toBe("docs");
  });

  it("returns empty array for unmatched query", () => {
    expect(filterPaletteCommands("zzqv unmatched command")).toHaveLength(0);
  });
});
