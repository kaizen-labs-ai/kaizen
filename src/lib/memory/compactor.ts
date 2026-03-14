import { callOpenRouter } from "@/lib/openrouter/client";
import { prisma } from "@/lib/db/prisma";
import { ensureAgentConfigs, COMPACTOR_DEFAULT_PROMPT } from "@/lib/agents/defaults";

// Pre-compiled placeholder regexes (avoid recompilation on every call)
const CONTEXT_LABEL_RE = /\{\{contextLabel\}\}/g;
const MAX_LINES_RE = /\{\{maxLines\}\}/g;

// Cached compactor agent config (both compactText and mergeUserMemory use the same one)
let _compactorConfigCache: { model: string; thinking: boolean; timeoutMs: number; systemPrompt: string } | null = null;

async function getCompactorConfig() {
  if (_compactorConfigCache) return _compactorConfigCache;
  await ensureAgentConfigs();
  const agentConfig = await prisma.agentConfig.findUnique({
    where: { id: "compactor" },
  });
  _compactorConfigCache = {
    model: agentConfig?.model ?? "openai/gpt-4o-mini",
    thinking: agentConfig?.thinking ?? false,
    timeoutMs: (agentConfig?.timeout ?? 60) * 1000,
    systemPrompt: agentConfig?.systemPrompt ?? COMPACTOR_DEFAULT_PROMPT,
  };
  return _compactorConfigCache;
}

/** Clear the compactor config cache (e.g. after settings change). */
export function clearCompactorConfigCache() {
  _compactorConfigCache = null;
}

const MERGE_PROMPT = `You are a memory manager. You have an existing memory document and new facts to integrate.

Rules:
- Merge the new facts INTO the existing document structure
- If a fact already exists in the document, DO NOT add it again
- If new information contradicts existing information, REPLACE the old with the new
- Keep the document well-organized with clear sections
- Remove any "## New Information" or "## Correction" headers -- integrate facts into appropriate sections
- Output ONLY the final merged markdown document, at most {{maxLines}} lines
- Preserve the document's existing structure and formatting
- Be concise: one line per fact, no redundant preamble`;

export async function compactText(
  text: string,
  maxLines: number,
  contextLabel: string
): Promise<string> {
  const config = await getCompactorConfig();

  // Replace placeholders in the prompt template
  CONTEXT_LABEL_RE.lastIndex = 0;
  MAX_LINES_RE.lastIndex = 0;
  const systemPrompt = config.systemPrompt
    .replace(CONTEXT_LABEL_RE, contextLabel)
    .replace(MAX_LINES_RE, String(maxLines));

  const response = await callOpenRouter({
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ],
    stream: false,
    thinking: config.thinking,
    timeout: config.timeoutMs,
    meta: { agentId: "compactor" },
  });

  return response.content;
}

export async function mergeUserMemory(
  existing: string,
  newFacts: string,
  maxLines: number
): Promise<string> {
  const config = await getCompactorConfig();

  MAX_LINES_RE.lastIndex = 0;
  const systemPrompt = MERGE_PROMPT.replace(MAX_LINES_RE, String(maxLines));

  const userMessage = `## Existing Memory\n\n${existing}\n\n## New Facts to Integrate\n\n${newFacts}`;

  const response = await callOpenRouter({
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    stream: false,
    thinking: config.thinking,
    timeout: config.timeoutMs,
    meta: { agentId: "compactor" },
  });

  return response.content;
}
