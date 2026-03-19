import { prisma } from "@/lib/db/prisma";

export async function getSetting(key: string, defaultValue: string = ""): Promise<string> {
  const setting = await prisma.setting.findUnique({ where: { key } });
  return setting?.value ?? defaultValue;
}

export async function setSetting(key: string, value: string) {
  return prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const settings = await prisma.setting.findMany();
  const map: Record<string, string> = { ...SETTING_DEFAULTS };
  for (const s of settings) {
    map[s.key] = s.value;
  }
  return map;
}

// Well-known setting keys
export const SETTING_KEYS = {
  DEFAULT_MODEL: "default_model",
  THEME_KIT_ENABLED: "theme_kit_enabled",
  LINK_PREVIEWS_ENABLED: "link_previews_enabled",
  VOICE_INPUT_ENABLED: "voice_input_enabled",
  VOICE_INPUT_MODEL: "voice_input_model",
  VOICE_INPUT_PROMPT: "voice_input_prompt",
  VOICE_INPUT_PROMPT_VERSION: "voice_input_prompt_version",
  VOICE_DICTATION_SHORTCUT: "voice_dictation_shortcut",
  BROWSER_INCOGNITO: "browser_incognito",
  INTERACTIVE_PLANNING: "interactive_planning",
  DEEP_SKILLS: "deep_skills",
} as const;

export const SETTING_DEFAULTS: Record<string, string> = {
  [SETTING_KEYS.DEFAULT_MODEL]: "anthropic/claude-sonnet-4",
  [SETTING_KEYS.THEME_KIT_ENABLED]: "true",
  [SETTING_KEYS.LINK_PREVIEWS_ENABLED]: "true",
  [SETTING_KEYS.VOICE_INPUT_ENABLED]: "true",
  [SETTING_KEYS.VOICE_INPUT_MODEL]: "google/gemini-2.5-flash",
  [SETTING_KEYS.VOICE_INPUT_PROMPT]: "Transcribe this audio into clean, well-formatted text. Fix filler words, false starts, and misheard words to produce natural sentences. If the speaker uses numbered items (e.g. \"one ... two ...\"), format them as a numbered list. Use proper punctuation and capitalization. Output ONLY the final text, nothing else.",
  [SETTING_KEYS.VOICE_INPUT_PROMPT_VERSION]: "2",
  [SETTING_KEYS.VOICE_DICTATION_SHORTCUT]: "",
  [SETTING_KEYS.BROWSER_INCOGNITO]: "false",
  [SETTING_KEYS.INTERACTIVE_PLANNING]: "false",
  [SETTING_KEYS.DEEP_SKILLS]: "true",
};

// Current code-level voice prompt version. Bump this when changing the default prompt.
export const VOICE_PROMPT_CODE_VERSION = 2;
