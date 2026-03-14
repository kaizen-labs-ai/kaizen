export interface WhatsAppConfig {
  phoneNumber: string | null;
  lid: string | null;
  selfChatOnly: boolean;
  allowedNumbers: string[];
  responsePrefix: string;
  model: string | null;
}

export const DEFAULT_WHATSAPP_CONFIG: WhatsAppConfig = {
  phoneNumber: null,
  lid: null,
  selfChatOnly: true,
  allowedNumbers: [],
  responsePrefix: "[Kaizen] ",
  model: null,
};

export function parseWhatsAppConfig(raw: string): WhatsAppConfig {
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_WHATSAPP_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_WHATSAPP_CONFIG };
  }
}
