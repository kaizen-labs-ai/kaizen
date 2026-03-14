import { getSecret } from "@/lib/vault/vault";

// ── Multimodal content types (OpenAI/OpenRouter format) ──────

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image_url";
  image_url: { url: string; detail?: "low" | "high" | "auto" };
}

export interface FileContentPart {
  type: "file";
  file: { filename: string; file_data: string };  // file_data: "data:mime;base64,..."
}

export interface VideoContentPart {
  type: "video_url";
  video_url: { url: string };
}

export interface InputAudioContentPart {
  type: "input_audio";
  input_audio: { data: string; format: string };
}

export type ContentPart = TextContentPart | ImageContentPart | VideoContentPart | FileContentPart | InputAudioContentPart;

/** Helper: create a text content part */
export function textPart(text: string): TextContentPart {
  return { type: "text", text };
}

/** Helper: create an image content part from base64 data */
export function imagePart(base64: string, mimeType: string, detail: "low" | "high" | "auto" = "auto"): ImageContentPart {
  return { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}`, detail } };
}

/** Helper: create a file content part from base64 data */
export function filePart(base64: string, mimeType: string, filename: string): FileContentPart {
  return { type: "file", file: { filename, file_data: `data:${mimeType};base64,${base64}` } };
}

/** Helper: create a video content part from base64 data.
 * Uses the `file` content type — `video_url` is silently dropped by many providers.
 * The `file` type with a data URI is reliably forwarded to Gemini and other video-capable models. */
export function videoPart(base64: string, mimeType: string, filename?: string): FileContentPart {
  return { type: "file", file: { filename: filename || "video.mp4", file_data: `data:${mimeType};base64,${base64}` } };
}

/** Helper: create an input_audio content part from base64 data */
export function inputAudioPart(base64: string, format: string): InputAudioContentPart {
  return { type: "input_audio", input_audio: { data: base64, format } };
}

// ── Chat message ─────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  reasoning?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface JsonSchema {
  name: string;
  strict?: boolean;
  schema: Record<string, unknown>;
}

interface CallOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  thinking?: boolean;
  /** Output modalities — e.g. ["image", "text"] for image generation models */
  modalities?: string[];
  /** Image generation config (aspect ratio, size) — OpenRouter-specific */
  image_config?: { aspect_ratio?: string; image_size?: string };
  response_format?: { type: "json_schema"; json_schema: JsonSchema };
  signal?: AbortSignal;
  /** Per-call timeout in milliseconds. Throws a descriptive error on expiry. */
  timeout?: number;
  /** Analytics metadata — used for usage tracking, not sent to OpenRouter */
  meta?: { agentId: string; runId?: string };
}

export interface NonStreamResponse {
  content: string;
  /** Raw content parts when the model returns multimodal output (e.g. images) */
  multimodalContent?: ContentPart[];
  reasoning?: string;
  toolCalls?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** Actual cost in USD from OpenRouter x-openrouter-cost header */
  cost?: number;
  /** Wall-clock time for the LLM call in milliseconds */
  durationMs?: number;
}

/** Thrown when OpenRouter returns 402 — the user's credits are exhausted. */
export class InsufficientCreditsError extends Error {
  constructor(detail?: string) {
    super(`OpenRouter credits exhausted${detail ? `: ${detail}` : ""}`);
    this.name = "InsufficientCreditsError";
  }
}

/** Strip leaked model control tokens (e.g. Gemini's <ctrl99>, <ctrl100>) */
const CTRL_TOKEN_RE = /<ctrl\d+>/gi;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export async function callOpenRouter(
  options: CallOptions & { stream: true }
): Promise<ReadableStream<Uint8Array>>;
export async function callOpenRouter(
  options: CallOptions & { stream?: false }
): Promise<NonStreamResponse>;
export async function callOpenRouter(
  options: CallOptions & { stream?: boolean }
): Promise<NonStreamResponse | ReadableStream<Uint8Array>> {
  const apiKey = await getSecret("openrouter_api_key");
  if (!apiKey) throw new Error("OpenRouter API key not configured. Add it via the onboarding dialog.");

  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: options.stream ?? false,
  };

  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = options.tool_choice ?? "auto";
  }
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
  if (options.thinking) body.reasoning = { effort: "high" };
  if (options.modalities?.length) body.modalities = options.modalities;
  if (options.image_config) body.image_config = options.image_config;
  if (options.response_format) body.response_format = options.response_format;

  // Combine caller signal + timeout into a single abort signal
  let fetchSignal = options.signal;
  if (options.timeout) {
    const timeoutSignal = AbortSignal.timeout(options.timeout);
    fetchSignal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
  }

  const startTime = performance.now();
  let res: Response;
  try {
    res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Kaizen",
      },
      body: JSON.stringify(body),
      signal: fetchSignal,
    });
  } catch (err) {
    // Convert timeout abort into a clear error message
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(`LLM call timed out after ${Math.round((options.timeout ?? 0) / 1000)}s (model: ${options.model})`);
    }
    throw err;
  }

  if (!res.ok) {
    const errBody = await res.text();
    if (res.status === 402) {
      throw new InsufficientCreditsError(errBody);
    }
    throw new Error(`OpenRouter API error ${res.status}: ${errBody}`);
  }

  if (options.stream) {
    return res.body!;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await res.json() as any;
  const choice = json.choices?.[0];

  // Handle multimodal response content (e.g. image generation models)
  // Images may come in content array OR in a separate "images" field
  const rawContent = choice?.message?.content;
  let content = "";
  let multimodalContent: ContentPart[] | undefined;

  if (Array.isArray(rawContent)) {
    multimodalContent = rawContent as ContentPart[];
    content = rawContent
      .filter((p: { type: string }) => p.type === "text")
      .map((p: { text?: string }) => p.text ?? "")
      .join("\n");
  } else {
    content = rawContent ?? "";
  }

  // Strip leaked model control tokens
  content = content.replace(CTRL_TOKEN_RE, "").trim();

  // Some models (e.g. Gemini via OpenRouter) return images in a separate "images" field
  const rawImages = choice?.message?.images;
  if (Array.isArray(rawImages) && rawImages.length > 0) {
    if (!multimodalContent) multimodalContent = [];
    if (content) multimodalContent.unshift({ type: "text", text: content });
    for (const img of rawImages) {
      if (img?.type === "image_url" && img?.image_url?.url) {
        multimodalContent.push(img as ImageContentPart);
      }
    }
  }

  const durationMs = Math.round(performance.now() - startTime);

  // OpenRouter returns cost in the response body (usage.total_cost or top-level usage)
  // Also check the x-openrouter-cost header as a fallback
  const costHeader = res.headers.get("x-openrouter-cost");
  const cost = json.usage?.total_cost
    ?? (json as Record<string, unknown>).total_cost
    ?? (costHeader ? parseFloat(costHeader) : undefined);

  // Fire-and-forget usage recording (dynamic import to avoid pulling Prisma into client bundle)
  import("@/lib/usage/record").then((mod) =>
    mod.recordLlmUsage({
      model: options.model,
      usage: json.usage,
      cost,
      durationMs,
      agentId: options.meta?.agentId ?? "unknown",
      runId: options.meta?.runId,
    })
  ).catch(() => {});

  return {
    content,
    multimodalContent,
    reasoning: choice?.message?.reasoning || undefined,
    toolCalls: choice?.message?.tool_calls?.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tc: any) => ({
        id: tc.id,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })
    ),
    usage: json.usage,
    cost,
    durationMs,
  };
}
