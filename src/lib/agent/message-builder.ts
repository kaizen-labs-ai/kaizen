/**
 * Centralized message construction for the orchestrator.
 * Replaces scattered messages.push() calls with semantic helpers
 * that enforce correct roles and formatting.
 */

import type { ChatMessage } from "@/lib/openrouter/client";
import { prisma } from "@/lib/db/prisma";
import { compactText } from "@/lib/memory/compactor";

// ── Message helpers ────────────────────────────────────────────

/** Add a tool result to the conversation. */
export function addToolResult(
  messages: ChatMessage[],
  toolCallId: string,
  content: unknown,
): void {
  messages.push({
    role: "tool",
    tool_call_id: toolCallId,
    content: JSON.stringify(content),
  });
}

/** Pipeline context as SYSTEM message — models don't echo system messages back. */
export function addPipelineContext(
  messages: ChatMessage[],
  text: string,
): void {
  messages.push({ role: "system", content: text });
}

/** Add a guardrail warning when consecutive failures or tool cap is hit. */
export function addGuardrailWarning(
  messages: ChatMessage[],
  type: "consecutive_fail_warn" | "consecutive_fail_stop" | "tool_cap" | "tool_loop" | "tool_loop_stop" | "search_pivot" | "tab_cycle",
  details?: { limit?: number; toolCallId?: string },
): void {
  const content = {
    consecutive_fail_warn:
      "Multiple tool calls have failed in a row. Try a different approach or call advance-phase if you cannot proceed.",
    consecutive_fail_stop:
      `${details?.limit ?? 5} consecutive tool calls have failed. Stop retrying and call advance-phase to finish. Explain what went wrong in your response.`,
    tool_cap:
      `Tool call limit (${details?.limit ?? 30}) reached. You must call advance-phase now to finish.`,
    tool_loop:
      "You have called the same tool with identical arguments multiple times. The page state has likely not changed. Try a completely different approach — use chrome-evaluate for JS interaction, navigate to a different URL, or use the site's search function.",
    tool_loop_stop:
      "CRITICAL: You have been stuck in a loop repeating the same actions despite multiple warnings. You MUST call advance-phase NOW and explain to the user what went wrong. Do NOT make any more tool calls — only call advance-phase.",
    search_pivot:
      "You have made several search attempts without finding what you need. STOP searching and try a different approach: use web-fetch to go directly to the source URL (e.g., the official website, channel page, RSS feed, or API endpoint). Direct fetching is often more reliable than repeated searches when looking for specific or recent content from a known source.",
    tab_cycle:
      "You are cycling through the same browser tabs repeatedly. Snapshot pruning removes old page content, causing you to re-read pages you already visited. STOP switching tabs now. Synthesize your findings from the information you have already gathered and call advance-phase. If you need to re-read a specific page, use web-fetch with its URL instead of Chrome.",
  }[type];

  if (type === "tool_cap" && details?.toolCallId) {
    addToolResult(messages, details.toolCallId, { error: content });
  } else {
    // Use "system" role so models don't echo guardrail text back to the user
    messages.push({ role: "system", content });
  }
}

/** Add a nudge when the agent describes intent without calling tools. */
export function addNudge(
  messages: ChatMessage[],
  agentId: string,
  assistantContent: string,
  reasoning?: string,
): void {
  messages.push({
    role: "assistant",
    content: assistantContent,
    ...(reasoning ? { reasoning } : {}),
  });
  const nudge = agentId === "planner"
    ? "You must call the advance-phase tool to move forward. Please call it now."
    : "Please proceed and use the available tools to complete this task. If you have already presented options or content that requires the user's input before you can continue, call advance-phase now to finish and wait for their response.";
  messages.push({ role: "user", content: nudge });
}

// ── Browser snapshot pruning ─────────────────────────────────

const BROWSER_TOOLS = new Set([
  "chrome-snapshot", "chrome-click", "chrome-fill",
  "chrome-navigate", "chrome-evaluate", "chrome-wait",
  "chrome-new-tab", "chrome-select-tab", "chrome-list-tabs",
]);
const PRUNE_CONTENT_THRESHOLD = 2000;
const KEEP_RECENT_SNAPSHOTS = 2;
const PRUNED_SUMMARY_CHARS = 200;
const NEWLINE_RE = /\n/g;

/**
 * Replace old, large browser tool results with a short summary placeholder.
 * Keeps the most recent KEEP_RECENT_SNAPSHOTS results intact.
 * Older results are replaced with a brief content summary (first ~200 chars)
 * so the agent retains a breadcrumb trail of where it has been.
 */
export function pruneStaleSnapshots(
  messages: ChatMessage[],
): { prunedCount: number; charsFreed: number } {
  // Build map: toolCallId → toolName from assistant messages
  const toolCallNames = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolCallNames.set(tc.id, tc.function.name);
      }
    }
  }

  // Find all large browser tool results
  const browserResultIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "tool" || !msg.tool_call_id) continue;
    const toolName = toolCallNames.get(msg.tool_call_id);
    if (!toolName || !BROWSER_TOOLS.has(toolName)) continue;
    const content = typeof msg.content === "string" ? msg.content : "";
    if (content.length > PRUNE_CONTENT_THRESHOLD) {
      browserResultIndices.push(i);
    }
  }

  // Keep only the last N, replace older ones with summary placeholder
  let prunedCount = 0;
  let charsFreed = 0;
  if (browserResultIndices.length > KEEP_RECENT_SNAPSHOTS) {
    const toPrune = browserResultIndices.slice(0, -KEEP_RECENT_SNAPSHOTS);
    for (const idx of toPrune) {
      const oldContent = messages[idx].content as string;
      // Extract a brief summary from the original content for breadcrumbs
      const summary = extractSnapshotSummary(oldContent);
      const replacement = JSON.stringify({
        pruned: true,
        note: `[Browser snapshot pruned — ${summary}]`,
      });
      charsFreed += oldContent.length - replacement.length;
      messages[idx].content = replacement;
      prunedCount++;
    }
  }

  return { prunedCount, charsFreed };
}

/** Extract a brief summary from a browser tool result for the pruned placeholder. */
function extractSnapshotSummary(content: string): string {
  try {
    const parsed = JSON.parse(content);
    // chrome-snapshot returns { snapshot: "..." }
    // chrome-click/fill/navigate return { result: "..." }
    const text = (parsed.snapshot ?? parsed.result ?? "") as string;
    if (!text) return "page content removed";
    // First ~200 chars give the page title, URL, and top-level elements
    NEWLINE_RE.lastIndex = 0;
    const trimmed = text.slice(0, PRUNED_SUMMARY_CHARS).replace(NEWLINE_RE, " ").trim();
    return trimmed ? `${trimmed}...` : "page content removed";
  } catch {
    return "page content removed";
  }
}

// ── Chat history compaction ───────────────────────────────────

export const COMPACT_THRESHOLD = 10;

export async function compactChatHistory(
  chatHistory: ChatMessage[],
  agentId: string,
): Promise<ChatMessage[]> {
  if (chatHistory.length <= COMPACT_THRESHOLD) return chatHistory;

  // Keep the last 4 messages raw for immediate context
  const KEEP_RAW = 4;
  const toCompact = chatHistory.slice(0, -KEEP_RAW);
  const toKeep = chatHistory.slice(-KEEP_RAW);

  const text = toCompact
    .map((m) =>
      `${m.role}: ${typeof m.content === "string" ? m.content.slice(0, 500) : "[multimodal content]"}`
    )
    .join("\n\n");

  try {
    const summary = await compactText(text, 20, `conversation context for ${agentId}`);
    return [
      { role: "user" as const, content: `## Prior Conversation Context\n\n${summary}` },
      ...toKeep,
    ];
  } catch {
    // If compaction fails, return original history
    return chatHistory;
  }
}

// ── Execution report builder ──────────────────────────────────

export async function buildExecutionReport(runId: string): Promise<string> {
  const steps = await prisma.step.findMany({
    where: { runId },
    orderBy: { sequence: "asc" },
  });

  const lines: string[] = ["## Execution Report\n"];

  for (const step of steps) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(step.content); } catch { continue; }

    switch (step.type) {
      case "tool_call":
        lines.push(`- **Tool called**: \`${parsed.name}\``);
        if (parsed.arguments) {
          const args = typeof parsed.arguments === "string"
            ? parsed.arguments
            : JSON.stringify(parsed.arguments);
          if (args.length < 300) lines.push(`  Arguments: ${args}`);
        }
        break;
      case "tool_result": {
        const result = parsed.result as Record<string, unknown> | undefined;
        if (result) {
          const success = (result as { success?: boolean }).success;
          const output = (result as { output?: Record<string, unknown> }).output;
          const summary = output && typeof output === "object" ? (output as { summary?: string }).summary : undefined;
          lines.push(`  Result: ${success ? "success" : "FAILED"}${summary ? ` — ${summary}` : ""}`);
        }
        break;
      }
      case "result":
        if (parsed.summary) lines.push(`- **Result saved**: ${parsed.summary}`);
        break;
      case "executor_summary":
        if (parsed.text) lines.push(`\n**Executor summary**: ${parsed.text}`);
        break;
    }
  }

  return lines.join("\n");
}
