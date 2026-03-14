import { prisma } from "@/lib/db/prisma";
import { getToolExecutor } from "./registry";
import type { ToolExecutionResult, ExecutionContext } from "./types";
import { checkToolPermission } from "./permission-guard";
import { createLog } from "@/lib/logs/logger";

// ── Common parameter aliases ────────────────────────────────
// Maps schema parameter names to known aliases that LLMs commonly use.
const KNOWN_ALIASES: Record<string, Set<string>> = {
  filename: new Set(["path", "filepath", "file_path", "file_name", "file", "name"]),
  path: new Set(["filename", "filepath", "file_path", "file_name", "file"]),
  url: new Set(["uri", "link", "href", "endpoint"]),
  content: new Set(["text", "body", "data", "value"]),
  query: new Set(["search", "q", "term", "search_query"]),
  summary: new Set(["description", "desc"]),
};

/**
 * Normalize tool arguments against the tool's inputSchema.
 *
 * When a required parameter is missing but an unrecognized argument looks
 * like an alias, remap it so the tool call succeeds. This handles the
 * common case where LLMs guess a plausible parameter name (e.g. "filename"
 * instead of "path") despite being given the correct schema.
 */
function normalizeToolArgs(
  args: Record<string, unknown>,
  inputSchema: string | null | undefined,
): Record<string, unknown> {
  if (!inputSchema) return args;

  let schema: { properties?: Record<string, { description?: string }>; required?: string[] };
  try {
    schema = JSON.parse(inputSchema);
  } catch {
    return args;
  }

  const { properties, required } = schema;
  if (!properties || !required) return args;

  const schemaKeys = new Set(Object.keys(properties));
  const missingRequired = required.filter((k) => args[k] === undefined);
  if (missingRequired.length === 0) return args; // all required params present

  const normalized = { ...args };
  const extraKeys = Object.keys(normalized).filter((k) => !schemaKeys.has(k));

  for (const reqKey of missingRequired) {
    for (const extraKey of extraKeys) {
      if (isLikelyAlias(reqKey, extraKey, properties[reqKey]?.description)) {
        normalized[reqKey] = normalized[extraKey];
        delete normalized[extraKey];
        createLog("warn", "tool", `Normalized arg "${extraKey}" → "${reqKey}"`, {
          original: extraKey,
          mapped: reqKey,
        }).catch(() => {});
        break;
      }
    }
  }

  return normalized;
}

function isLikelyAlias(schemaKey: string, argKey: string, description?: string): boolean {
  const sLower = schemaKey.toLowerCase();
  const aLower = argKey.toLowerCase();

  // Exact match after lowercasing
  if (sLower === aLower) return true;

  // Substring containment (e.g. "filepath" contains "path")
  if (aLower.includes(sLower) || sLower.includes(aLower)) return true;

  // Check known alias table
  if (KNOWN_ALIASES[sLower]?.has(aLower)) return true;

  // Check if the arg key appears in the property description
  if (description && description.toLowerCase().includes(aLower)) return true;

  return false;
}

export async function executeTool(
  rawToolName: string,
  input: Record<string, unknown>,
  context?: ExecutionContext,
  /** Pre-loaded inputSchema — avoids a DB query when the caller already has it. */
  inputSchema?: string | null,
): Promise<ToolExecutionResult> {
  // Normalize tool name: some models use underscores instead of hyphens
  // (e.g. Gemini calls "advance_phase" instead of "advance-phase").
  // Skip zapier_ tools which intentionally use underscores.
  const toolName = rawToolName.startsWith("zapier_")
    ? rawToolName
    : rawToolName.replace(/_/g, "-");

  // Server-side permission guard: reject tools the contact isn't allowed to use.
  // This is the last line of defense — even if a tool was accidentally offered
  // to the LLM, or the LLM hallucinated a tool call, it won't execute.
  if (context?.contactId) {
    const denied = await checkToolPermission(toolName, context.contactId);
    if (denied) {
      return { success: false, output: null, error: denied };
    }
  }

  // Normalize arguments against the tool's schema before execution.
  // This remaps common LLM parameter-name mistakes (e.g. "filename" → "path").
  let normalizedInput = input;
  try {
    // Use pre-loaded schema if available, otherwise fall back to DB query
    const schema = inputSchema !== undefined
      ? inputSchema
      : (await prisma.tool.findUnique({ where: { name: toolName }, select: { inputSchema: true } }))?.inputSchema;
    normalizedInput = normalizeToolArgs(input, schema);
  } catch {
    // Best-effort — proceed with original input
  }

  const executor = await getToolExecutor(toolName, context);
  if (!executor) {
    return { success: false, output: null, error: `Tool "${toolName}" not found or disabled` };
  }

  try {
    return await executor(normalizedInput);
  } catch (err) {
    return {
      success: false,
      output: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
