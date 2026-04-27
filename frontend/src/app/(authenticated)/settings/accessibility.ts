export const SETTINGS_TABS = [
  "api",
  "branding",
  "display",
  "webhooks",
  "danger",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];
export type SettingsTabVariant = "desktop" | "mobile";

export function getSettingsTabDomId(
  tab: SettingsTab,
  variant: SettingsTabVariant,
) {
  return variant === "desktop" ? `${tab}-tab` : `${tab}-tab-mobile`;
}

export function getSettingsPanelDomId(tab: SettingsTab) {
  return `${tab}-panel`;
}

export function getNextSettingsTab(
  currentTab: SettingsTab,
  key: string,
): SettingsTab {
  const currentIndex = SETTINGS_TABS.indexOf(currentTab);

  if (currentIndex === -1) {
    return SETTINGS_TABS[0];
  }

  if (key === "Home") {
    return SETTINGS_TABS[0];
  }

  if (key === "End") {
    return SETTINGS_TABS[SETTINGS_TABS.length - 1];
  }

  if (key === "ArrowRight" || key === "ArrowDown") {
    return SETTINGS_TABS[(currentIndex + 1) % SETTINGS_TABS.length];
  }

  if (key === "ArrowLeft" || key === "ArrowUp") {
    return SETTINGS_TABS[
      (currentIndex - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length
    ];
  }

  return currentTab;
}
