/**
 * Agent verification gates and guardrail helpers.
 * Extracted from agent-loop.ts to keep it under 800 lines.
 *
 * Gates:
 * - Pre-execution tool gates: batch deferral, pipeline lock, zapier block,
 *   empty-work, browser verification, claim verification, grounding
 * - Claim verification: detects when the agent claims actions it never performed
 * - Grounding gate: detects fabricated URLs not found in tool results
 * - Search-pivot detection: tracks consecutive thin search results
 */

import type { ChatMessage } from "@/lib/openrouter/client";
import type { AgentLoopState } from "./schemas";
import { addToolResult } from "./message-builder";
import { createLog } from "@/lib/logs/logger";

// ── Administrative tools ─────────────────────────────────────────
// Tools that don't count as "substantive work" (used in empty-work gate).
export const ADMIN_TOOLS = new Set(["advance-phase"]);

// Tools blocked after pipeline output is locked (prevents manual re-creation).
const PIPELINE_LOCKED_TOOLS = new Set(["run-snippet", "file-write"]);

// Tools blocked after Zapier config URL guidance (prevents creation of broken skills).
const ZAPIER_BLOCKED_TOOLS = new Set(["create-skill", "create-schedule", "create-plugin"]);

// ── Claim verification ──────────────────────────────────────────

export interface UnverifiedClaim {
  claim: string;
  requiredTool: string;
  instruction: string;
}

// Pre-compiled claim detection patterns (avoid recompiling on every call)
const SKILL_MOD_RE1 = /\b(updated|modified|changed|integrated|edited|improved|upgraded|optimized|rewrit|refactor)\w*\b[^.!?\n]*\b(skill|skill['']s)\b/i;
const SKILL_MOD_RE2 = /\b(skill)\b[^.!?\n]*\b(updated|modified|changed|integrated|edited|improved|upgraded|optimized|has been|is now)\b/i;
const PLUGIN_MOD_RE1 = /\b(updated|modified|changed|integrated|edited|improved|upgraded|created|built|rewrit)\w*\b[^.!?\n]*\b(plugin|script)\b/i;
const PLUGIN_MOD_RE2 = /\b(plugin|script)\b[^.!?\n]*\b(updated|modified|changed|integrated|edited|improved|created|built|has been|is now)\b/i;
const FILE_SAVE_RE = /\b(saved|exported|wrote|written|generated|created)\b[^.!?\n]*\b(file|report|csv|document|pdf)\b/i;

export function verifyOutputClaims(text: string, toolNamesUsed: Set<string>, pluginNames: Set<string> = new Set()): UnverifiedClaim[] {
  if (!text) return [];
  const claims: UnverifiedClaim[] = [];

  // Skill modification claims
  if (SKILL_MOD_RE1.test(text) || SKILL_MOD_RE2.test(text)) {
    if (!toolNamesUsed.has("edit-skill") && !toolNamesUsed.has("create-skill")) {
      claims.push({
        claim: "modified a skill",
        requiredTool: "edit-skill",
        instruction: "You claimed you updated/modified a skill, but you never called edit-skill. Either call edit-skill now to actually update it, or rephrase your response to accurately describe what you did.",
      });
    }
  }

  // Plugin modification claims
  if (PLUGIN_MOD_RE1.test(text) || PLUGIN_MOD_RE2.test(text)) {
    if (!toolNamesUsed.has("edit-plugin") && !toolNamesUsed.has("create-plugin")) {
      claims.push({
        claim: "modified a plugin",
        requiredTool: "edit-plugin or create-plugin",
        instruction: "You claimed you updated/created a plugin, but you never called edit-plugin or create-plugin. Either do it now, or rephrase your response.",
      });
    }
  }

  // File save claims — but exclude when file-producing tools were used
  if (FILE_SAVE_RE.test(text)) {
    const hasFileWriter = toolNamesUsed.has("file-write") || toolNamesUsed.has("save-result");
    let hasExternalSaver = false;
    let hasPluginCall = false;
    for (const n of toolNamesUsed) {
      if (n.startsWith("zapier_")) { hasExternalSaver = true; break; }
    }
    if (!hasExternalSaver && pluginNames.size > 0) {
      for (const n of toolNamesUsed) {
        if (pluginNames.has(n)) { hasPluginCall = true; break; }
      }
    }
    if (!hasFileWriter && !hasExternalSaver && !hasPluginCall) {
      claims.push({
        claim: "saved a file",
        requiredTool: "file-write or save-result",
        instruction: "You claimed you saved/exported a file, but you never called file-write or save-result. Either save the file now, or rephrase your response.",
      });
    }
  }

  return claims;
}

// Pre-compiled sanitization patterns (avoid recompiling on every call)
const SANITIZE_SKILL_RE1 = /[^.!?\n]*\b(updated|modified|changed|integrated|edited|improved|upgraded|optimized|rewrit|refactor)\w*\b[^.!?\n]*\b(skill)\b[^.!?\n]*[.!?]?\s*/gi;
const SANITIZE_SKILL_RE2 = /[^.!?\n]*\b(skill)\b[^.!?\n]*\b(updated|modified|changed|integrated|edited|improved|upgraded|optimized|has been|is now)\b[^.!?\n]*[.!?]?\s*/gi;
const SANITIZE_PLUGIN_RE = /[^.!?\n]*\b(updated|modified|changed|integrated|edited|improved|upgraded|created|built|rewrit)\w*\b[^.!?\n]*\b(plugin|script)\b[^.!?\n]*[.!?]?\s*/gi;
const SANITIZE_FILE_RE = /[^.!?\n]*\b(saved|exported|wrote|written|generated|created)\b[^.!?\n]*\b(file|report|csv|document|pdf)\b[^.!?\n]*[.!?]?\s*/gi;

/** Strip sentences containing false claims from output text. */
export function sanitizeFalseClaims(text: string, claims: UnverifiedClaim[]): string {
  let result = text;
  for (const claim of claims) {
    if (claim.requiredTool === "edit-skill") {
      SANITIZE_SKILL_RE1.lastIndex = 0;
      SANITIZE_SKILL_RE2.lastIndex = 0;
      result = result.replace(SANITIZE_SKILL_RE1, "");
      result = result.replace(SANITIZE_SKILL_RE2, "");
    }
    if (claim.requiredTool.includes("plugin")) {
      SANITIZE_PLUGIN_RE.lastIndex = 0;
      result = result.replace(SANITIZE_PLUGIN_RE, "");
    }
    if (claim.requiredTool.includes("file")) {
      SANITIZE_FILE_RE.lastIndex = 0;
      result = result.replace(SANITIZE_FILE_RE, "");
    }
  }
  return result.trim();
}

// ── Search tool detection ───────────────────────────────────────

/** General pattern: any tool with "search" in its name is a search tool. */
export function isSearchTool(toolName: string): boolean {
  return toolName.includes("search");
}

/** Check if a tool result has thin results (few or zero matches). */
export function isSearchResultThin(result: { success: boolean; output?: unknown }): boolean {
  if (!result.success) return true;
  if (!result.output || typeof result.output !== "object") return true;
  const out = result.output as Record<string, unknown>;
  // Check common count fields from search tools
  for (const key of ["resultCount", "videoCount", "articleCount", "imageCount"]) {
    if (typeof out[key] === "number") return (out[key] as number) <= 2;
  }
  // Check for empty result arrays
  for (const key of ["results", "videos", "articles", "images"]) {
    if (Array.isArray(out[key])) return (out[key] as unknown[]).length <= 2;
  }
  return false;
}

// ── URL extraction for grounding gate ───────────────────────────

const URL_REGEX = /https?:\/\/[^\s)\]>"'`]+/gi;
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;

export function extractUrls(text: string): Set<string> {
  const urls = new Set<string>();
  URL_REGEX.lastIndex = 0;
  const matches = text.match(URL_REGEX);
  if (matches) {
    for (const url of matches) {
      urls.add(url.replace(TRAILING_PUNCT_RE, ""));
    }
  }
  return urls;
}

/**
 * Find URLs in the agent's output that don't appear in any tool result.
 * Returns the ungrounded URLs. Only meaningful when there are 3+ ungrounded
 * URLs — a couple of known/contextual URLs are fine.
 */
export function findUngroundedUrls(agentText: string, toolResultUrls: Set<string>): string[] {
  const outputUrls = extractUrls(agentText);
  if (outputUrls.size === 0) return [];
  const ungrounded: string[] = [];
  for (const url of outputUrls) {
    // Check exact match or prefix match (tool might return full URL, agent might truncate)
    let grounded = false;
    for (const tru of toolResultUrls) {
      if (tru === url || url.startsWith(tru) || tru.startsWith(url)) {
        grounded = true;
        break;
      }
    }
    if (!grounded) ungrounded.push(url);
  }
  return ungrounded;
}

/**
 * Strip ungrounded URLs from agent output text (post-loop sanitization).
 * Used when the agent exits without calling advance-phase, bypassing the
 * interactive grounding gate. Converts markdown links to plain text and
 * removes bare fabricated URLs.
 */
export function sanitizeUngroundedUrls(text: string, ungroundedUrls: string[]): string {
  if (!text || ungroundedUrls.length === 0) return text;
  let result = text;
  for (const url of ungroundedUrls) {
    // Escape URL for use in regex (dots, slashes, etc.)
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Replace markdown links [text](url) → text
    result = result.replace(new RegExp(`\\[([^\\]]*)\\]\\(${escaped}\\)`, "g"), "$1");
    // Replace bare URLs that remain
    result = result.replace(new RegExp(escaped, "g"), "[link unavailable]");
  }
  return result;
}

// ── Pre-execution tool gates ────────────────────────────────────

export interface ToolGateParams {
  toolCallId: string;
  toolName: string;
  allToolCalls: Array<{ id: string; function: { name: string } }>;
  agentId: string;
  runId: string;
  messages: ChatMessage[];
  state: AgentLoopState;
  pluginNames?: Set<string>;
  recordStep: (type: string, content: unknown, toolId?: string) => Promise<void>;
}

/**
 * Evaluate pre-execution gates for a tool call.
 * Returns true if the tool call was blocked (caller should skip execution).
 */
export async function evaluateToolGates(params: ToolGateParams): Promise<boolean> {
  const { toolCallId, toolName, allToolCalls, agentId, runId, messages, state, pluginNames, recordStep } = params;

  // ── Batch deferral gate ──
  // Defer advance-phase when bundled with other tools so the agent can
  // summarize results instead of pre-empting with a plan.
  if (toolName === "advance-phase" && agentId === "executor") {
    const batchHasOtherTools = allToolCalls.some(
      (other) => other.id !== toolCallId && !ADMIN_TOOLS.has(other.function.name)
    );
    if (batchHasOtherTools) {
      addToolResult(messages, toolCallId, {
        success: false,
        error: "Do not call advance-phase in the same batch as other tools. Review the results of your actions first, then summarize what you accomplished for the user before completing.",
      });
      await recordStep("tool_result", {
        toolCallId,
        name: "advance-phase",
        result: { success: false, error: "Batch deferral — advance-phase deferred until next iteration" },
        agent: agentId,
      });
      return true;
    }
  }

  // ── Pipeline output lock — block manual re-creation after pipeline passes ──
  if (state.pipelineOutputLocked && PIPELINE_LOCKED_TOOLS.has(toolName)) {
    addToolResult(messages, toolCallId, {
      success: false,
      error: "The code pipeline already produced validated output files. Do NOT re-create them manually. Call advance-phase to complete and present the results to the user.",
    });
    await recordStep("tool_result", {
      toolCallId,
      name: toolName,
      result: { success: false, error: "Pipeline output lock — manual re-creation blocked" },
      agent: agentId,
    });
    return true;
  }

  // ── Zapier guidance gate — block skill/schedule/plugin creation after config URL was given ──
  if (state.zapierGuidanceGiven && ZAPIER_BLOCKED_TOOLS.has(toolName)) {
    createLog("warn", "orchestrator", `Zapier guidance gate: blocked ${toolName} after zapier_get_configuration_url`, {}, runId).catch(() => {});
    addToolResult(messages, toolCallId, {
      success: false,
      error: "BLOCKED: You already called zapier_get_configuration_url, which means the required external service is NOT connected. Do NOT create skills, schedules, or plugins that depend on missing Zapier tools — they will fail silently. Tell the user to add the service via Zapier first, then call advance-phase to complete.",
    });
    await recordStep("tool_result", {
      toolCallId,
      name: toolName,
      result: { success: false, error: "Zapier guidance gate — creation blocked, service not connected" },
      agent: agentId,
    });
    return true;
  }

  // ── Empty-work gate — reject advance-phase with 0 substantive tool calls ──
  if (toolName === "advance-phase" && agentId === "executor" && state.substantiveToolCalls === 0) {
    createLog("warn", "orchestrator", `Empty-work gate: executor called advance-phase with 0 substantive tool calls`, {}, runId).catch(() => {});
    addToolResult(messages, toolCallId, {
      success: false,
      error: "You have not done any work yet. Your response describes actions you intend to take, but you haven't actually taken them. Use your tools (web-fetch, chrome-*, run-snippet, file-write, save-result, etc.) to DO the work first, then call advance-phase when you're truly done.",
    });
    await recordStep("tool_result", {
      toolCallId,
      name: "advance-phase",
      result: { success: false, error: "Empty-work gate — no substantive tool calls" },
      agent: agentId,
    });
    return true;
  }

  // ── Skill auto-test gate — nudge executor to test skill before completing ──
  if (toolName === "advance-phase" && agentId === "executor" && state.skillCreatedNotTested) {
    createLog("warn", "orchestrator", `Skill auto-test gate: executor called advance-phase after create/edit-skill without testing`, {}, runId).catch(() => {});
    addToolResult(messages, toolCallId, {
      success: false,
      error: "You created or edited a skill but haven't done a full end-to-end test. Execute EVERY step in the skill instructions now — call the actual tools (web-fetch, brave-search, chrome-*, skill-db-execute, file-write, etc.) to produce real output. Partial checks are not enough. If a step fails, fix it yourself (try alternative approaches, update instructions via edit-skill). Do NOT ask the user — be autonomous. Only call advance-phase after the skill has produced its expected output (DB entries, files, etc.).",
    });
    await recordStep("tool_result", {
      toolCallId,
      name: "advance-phase",
      result: { success: false, error: "Skill auto-test gate — skill created/edited but not tested" },
      agent: agentId,
    });
    // One-shot nudge — clear flag and mark as fired to prevent edit-skill re-trigger loop
    state.skillCreatedNotTested = false;
    state.deepSkillsNudgeFired = true;
    return true;
  }

  // ── Browser verification gate — force snapshot before completing browser tasks ──
  if (toolName === "advance-phase" && agentId === "executor" && state.browserToolsUsed && state.advancePhaseAttempts === 0) {
    state.advancePhaseAttempts++;
    addToolResult(messages, toolCallId, {
      success: false,
      error: "Before completing browser tasks, you MUST verify your work. Take a chrome-snapshot of the final result (e.g., the cart page, confirmation page, or current state) and compare it against EVERY item in the original objective. If anything is missing or incomplete, continue working. Only call advance-phase again after confirming everything is done.",
    });
    await recordStep("tool_result", {
      toolCallId,
      name: "advance-phase",
      result: { success: false, error: "Browser verification gate — forced snapshot check" },
      agent: agentId,
    });
    return true;
  }

  // ── Claim verification gate — reject unverified action claims ──
  if (toolName === "advance-phase" && agentId === "executor" && state.agentRawText && !state.claimGateFired) {
    const unverifiedClaims = verifyOutputClaims(state.agentRawText, state.toolNamesUsed, pluginNames);
    if (unverifiedClaims.length > 0) {
      state.claimGateFired = true;
      const claimList = unverifiedClaims.map((c) => c.claim).join(", ");
      const instructions = unverifiedClaims.map((c) => `- ${c.instruction}`).join("\n");
      createLog("warn", "orchestrator", `Claim verification gate: ${claimList}`, {}, runId).catch(() => {});
      addToolResult(messages, toolCallId, {
        success: false,
        error: `Your response contains claims that don't match your actions:\n${instructions}\n\nFix this before completing. The user must NEVER see false claims.`,
      });
      await recordStep("tool_result", {
        toolCallId,
        name: "advance-phase",
        result: { success: false, error: `Claim verification gate — unverified: ${claimList}` },
        agent: agentId,
      });
      return true;
    }
  }

  // ── Grounding gate — reject fabricated URLs not found in tool results ──
  if (toolName === "advance-phase" && agentId === "executor" && state.agentRawText && !state.groundingGateFired) {
    const ungrounded = findUngroundedUrls(state.agentRawText, state.toolResultUrls);
    if (ungrounded.length >= 3) {
      state.groundingGateFired = true;
      createLog("warn", "orchestrator", `Grounding gate: ${ungrounded.length} ungrounded URLs in output`, { sample: ungrounded.slice(0, 5) }, runId).catch(() => {});
      addToolResult(messages, toolCallId, {
        success: false,
        error: `Your response contains ${ungrounded.length} URLs that don't appear in any tool results you received. You may be fabricating links. ONLY include URLs that were actually returned by your tools. If you couldn't find enough results, say so honestly — never invent URLs or content. Remove or replace the unverified URLs, then try again.`,
      });
      await recordStep("tool_result", {
        toolCallId,
        name: "advance-phase",
        result: { success: false, error: `Grounding gate — ${ungrounded.length} ungrounded URLs` },
        agent: agentId,
      });
      return true;
    }
  }

  return false;
}
