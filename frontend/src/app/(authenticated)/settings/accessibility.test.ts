/**
 * Unit tests for Settings accessibility helpers — Issue #985
 */
import { describe, expect, it } from "vitest";
import {
  getNextSettingsTab,
  getSettingsPanelDomId,
  getSettingsTabDomId,
  SETTINGS_TABS,
} from "./accessibility";

describe("settings accessibility helpers", () => {
  // ── DOM id helpers ─────────────────────────────────────────────────────

  it("returns stable tab and panel ids", () => {
    expect(getSettingsTabDomId("api", "desktop")).toBe("api-tab");
    expect(getSettingsTabDomId("webhooks", "mobile")).toBe("webhooks-tab-mobile");
    expect(getSettingsPanelDomId("danger")).toBe("danger-panel");
  });

  it("generates ids for every tab without collision", () => {
    const desktopIds = SETTINGS_TABS.map((t) => getSettingsTabDomId(t, "desktop"));
    const mobileIds = SETTINGS_TABS.map((t) => getSettingsTabDomId(t, "mobile"));
    const panelIds = SETTINGS_TABS.map((t) => getSettingsPanelDomId(t));

    expect(new Set(desktopIds).size).toBe(SETTINGS_TABS.length);
    expect(new Set(mobileIds).size).toBe(SETTINGS_TABS.length);
    expect(new Set(panelIds).size).toBe(SETTINGS_TABS.length);
  });

  it("desktop and mobile ids are distinct for the same tab", () => {
    for (const tab of SETTINGS_TABS) {
      expect(getSettingsTabDomId(tab, "desktop")).not.toBe(
        getSettingsTabDomId(tab, "mobile")
      );
    }
  });

  it("panel id follows the aria-controls pattern '<tab>-panel'", () => {
    for (const tab of SETTINGS_TABS) {
      expect(getSettingsPanelDomId(tab)).toBe(`${tab}-panel`);
    }
  });

  // ── Keyboard navigation ────────────────────────────────────────────────

  it("moves to the next tab on ArrowRight and wraps at the end", () => {
    expect(getNextSettingsTab("api", "ArrowRight")).toBe("branding");
    expect(getNextSettingsTab("danger", "ArrowRight")).toBe("api");
  });

  it("moves to the previous tab on ArrowLeft and wraps at the start", () => {
    expect(getNextSettingsTab("branding", "ArrowLeft")).toBe("api");
    expect(getNextSettingsTab("api", "ArrowLeft")).toBe("danger");
  });

  it("ArrowDown behaves the same as ArrowRight", () => {
    for (const tab of SETTINGS_TABS) {
      expect(getNextSettingsTab(tab, "ArrowDown")).toBe(
        getNextSettingsTab(tab, "ArrowRight")
      );
    }
  });

  it("ArrowUp behaves the same as ArrowLeft", () => {
    for (const tab of SETTINGS_TABS) {
      expect(getNextSettingsTab(tab, "ArrowUp")).toBe(
        getNextSettingsTab(tab, "ArrowLeft")
      );
    }
  });

  it("supports Home and End keyboard navigation", () => {
    expect(getNextSettingsTab("webhooks", "Home")).toBe("api");
    expect(getNextSettingsTab("branding", "End")).toBe("danger");
  });

  it("Home always returns the first tab regardless of current", () => {
    for (const tab of SETTINGS_TABS) {
      expect(getNextSettingsTab(tab, "Home")).toBe(SETTINGS_TABS[0]);
    }
  });

  it("End always returns the last tab regardless of current", () => {
    for (const tab of SETTINGS_TABS) {
      expect(getNextSettingsTab(tab, "End")).toBe(
        SETTINGS_TABS[SETTINGS_TABS.length - 1]
      );
    }
  });

  it("keeps the current tab for unsupported keys", () => {
    expect(getNextSettingsTab("display", "Enter")).toBe("display");
    expect(getNextSettingsTab("api", "Tab")).toBe("api");
    expect(getNextSettingsTab("danger", "Escape")).toBe("danger");
  });

  it("round-trips through every tab via ArrowRight", () => {
    let tab = SETTINGS_TABS[0];
    for (let i = 0; i < SETTINGS_TABS.length; i++) {
      tab = getNextSettingsTab(tab, "ArrowRight");
    }
    expect(tab).toBe(SETTINGS_TABS[0]);
  });

  it("round-trips through every tab via ArrowLeft", () => {
    let tab = SETTINGS_TABS[0];
    for (let i = 0; i < SETTINGS_TABS.length; i++) {
      tab = getNextSettingsTab(tab, "ArrowLeft");
    }
    expect(tab).toBe(SETTINGS_TABS[0]);
  });
});
