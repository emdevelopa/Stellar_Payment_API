import { describe, expect, it } from "vitest";
import {
  getNextSettingsTab,
  getSettingsPanelDomId,
  getSettingsTabDomId,
} from "./accessibility";

describe("settings accessibility helpers", () => {
  it("returns stable tab and panel ids", () => {
    expect(getSettingsTabDomId("api", "desktop")).toBe("api-tab");
    expect(getSettingsTabDomId("webhooks", "mobile")).toBe(
      "webhooks-tab-mobile",
    );
    expect(getSettingsPanelDomId("danger")).toBe("danger-panel");
  });

  it("moves to the next tab on ArrowRight and wraps at the end", () => {
    expect(getNextSettingsTab("api", "ArrowRight")).toBe("branding");
    expect(getNextSettingsTab("danger", "ArrowRight")).toBe("api");
  });

  it("moves to the previous tab on ArrowLeft and wraps at the start", () => {
    expect(getNextSettingsTab("branding", "ArrowLeft")).toBe("api");
    expect(getNextSettingsTab("api", "ArrowLeft")).toBe("danger");
  });

  it("supports Home and End keyboard navigation", () => {
    expect(getNextSettingsTab("webhooks", "Home")).toBe("api");
    expect(getNextSettingsTab("branding", "End")).toBe("danger");
  });

  it("keeps the current tab for unsupported keys", () => {
    expect(getNextSettingsTab("display", "Enter")).toBe("display");
  });
});
