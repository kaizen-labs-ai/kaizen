import { NextResponse } from "next/server";
import { callOpenRouter, textPart, inputAudioPart } from "@/lib/openrouter/client";
import { getSetting, SETTING_KEYS, SETTING_DEFAULTS } from "@/lib/settings/registry";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { audio, format } = body as { audio: string; format: string };

    if (!audio || !format) {
      return NextResponse.json(
        { error: "audio (base64) and format are required" },
        { status: 400 },
      );
    }

    const enabled = await getSetting(
      SETTING_KEYS.VOICE_INPUT_ENABLED,
      SETTING_DEFAULTS[SETTING_KEYS.VOICE_INPUT_ENABLED],
    );
    if (enabled !== "true") {
      return NextResponse.json(
        { error: "Voice input is disabled" },
        { status: 403 },
      );
    }

    const model = await getSetting(
      SETTING_KEYS.VOICE_INPUT_MODEL,
      SETTING_DEFAULTS[SETTING_KEYS.VOICE_INPUT_MODEL],
    );

    const prompt = await getSetting(
      SETTING_KEYS.VOICE_INPUT_PROMPT,
      SETTING_DEFAULTS[SETTING_KEYS.VOICE_INPUT_PROMPT],
    );

    const response = await callOpenRouter({
      model,
      messages: [
        {
          role: "user",
          content: [
            textPart(prompt),
            inputAudioPart(audio, format),
          ],
        },
      ],
      temperature: 0,
      max_tokens: 4096,
      timeout: 60_000,
      meta: { agentId: "transcribe" },
    });

    return NextResponse.json({ text: response.content.trim() });
  } catch (err) {
    console.error("[transcribe] Error:", err);
    const message =
      err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
