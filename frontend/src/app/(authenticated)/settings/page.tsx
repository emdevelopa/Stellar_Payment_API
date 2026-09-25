import { getTranslations } from "next-intl/server";
import SettingsWidget from "./SettingsWidget";

export async function generateMetadata() {
  const t = await getTranslations("settingsPage");

  return {
    title: `${t("title")} — PLUTO`,
    description: t("description"),
  };
}

export default function SettingsPage() {
  return <SettingsWidget />;
}
