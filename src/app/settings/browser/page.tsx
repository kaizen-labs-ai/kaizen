import { getAllSettings } from "@/lib/settings/registry";
import { BrowserSettingsClient } from "./browser-settings-client";

export default async function BrowserSettingsPage() {
  const settings = await getAllSettings();
  return <BrowserSettingsClient initialData={settings} />;
}
