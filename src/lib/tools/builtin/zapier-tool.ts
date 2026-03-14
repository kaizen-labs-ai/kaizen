/**
 * Generic executor for all zapier_* tools.
 * Looks up the remote tool name from Tool.config and delegates to the MCP client.
 * Scrubs secrets from responses before they reach the LLM.
 */
import type { ToolExecutionResult } from "../types";
import { callZapierTool } from "@/lib/mcp/zapier-client";
import { prisma } from "@/lib/db/prisma";

/**
 * Execute a Zapier tool by mapping the local name (zapier_xxx) to the remote name (xxx).
 */
export async function zapierToolExecutor(
  input: Record<string, unknown>,
  toolName: string,
): Promise<ToolExecutionResult> {
  const tool = await prisma.tool.findUnique({ where: { name: toolName } });
  if (!tool) {
    return { success: false, output: null, error: `Zapier tool "${toolName}" not found` };
  }

  let remoteName: string;
  try {
    const config = JSON.parse(tool.config);
    remoteName = config.remoteName;
  } catch {
    return { success: false, output: null, error: `Invalid config for "${toolName}"` };
  }

  if (!remoteName) {
    return { success: false, output: null, error: `No remote name configured for "${toolName}"` };
  }

  try {
    const result = await callZapierTool(remoteName, input);
    return {
      success: true,
      output: { result: scrubSecrets(result) },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: null,
      error: `Zapier tool "${remoteName}" failed: ${scrubSecrets(msg)}`,
    };
  }
}

// Pre-compiled secret scrubbing regexes (called on every Zapier tool result)
const BEARER_TOKEN_RE = /Bearer\s+[A-Za-z0-9_\-./+=]{20,}/gi;
const API_KEY_RE = /(?:sk_live_|sk_test_|nk_|api[_-]?key[=:]\s*)[A-Za-z0-9_\-./+=]{10,}/gi;

/** Remove anything that looks like an API key or bearer token from tool output. */
function scrubSecrets(text: string): string {
  BEARER_TOKEN_RE.lastIndex = 0;
  API_KEY_RE.lastIndex = 0;
  return text
    .replace(BEARER_TOKEN_RE, "Bearer [REDACTED]")
    .replace(API_KEY_RE, "[REDACTED_KEY]");
}
