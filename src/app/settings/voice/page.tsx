import { getAllSettings } from "@/lib/settings/registry";
import { VoiceSettingsClient } from "./voice-settings-client";

export default async function VoiceSettingsPage() {
  const settings = await getAllSettings();
  return <VoiceSettingsClient initialData={settings} />;
}
