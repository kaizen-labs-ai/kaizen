import { getAllSettings } from "@/lib/settings/registry";
import { ThemeSettingsClient } from "./theme-settings-client";

export default async function ThemeSettingsPage() {
  const settings = await getAllSettings();
  return <ThemeSettingsClient initialData={settings} />;
}
