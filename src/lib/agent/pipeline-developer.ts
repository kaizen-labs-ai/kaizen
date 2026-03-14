/**
 * Pipeline developer phase — builds prompt, runs tool-calling loop,
 * applies patches, validates syntax, and executes the plugin.
 */

import type { ChatMessage, ToolDefinition } from "@/lib/openrouter/client";
import { callOpenRouterWithRetry } from "@/lib/openrouter/retry";
import { createLog } from "@/lib/logs/logger";
import { executeTool } from "@/lib/tools/executor";
import { getSetting } from "@/lib/settings/registry";
import type { RecordStepFn } from "./schemas";
import {
  extractCode,
  extractBannedAPIs,
  generateSampleInputs,
} from "./pipeline-utils";
import { validateSyntax, executePluginInPipeline } from "./pipeline-subprocess";
import { applySearchReplaceBlocks } from "./patch-engine";

// ── Constants ──────────────────────────────────────────────────

/** Shared patch mode format example (used in both edit-plugin and retry patch prompts). */
const PATCH_FORMAT_BLOCK =
  `<<<<<<< SEARCH\nexact lines from the current script to find\n=======\nreplacement lines\n>>>>>>> REPLACE`;

const PATCH_RULES =
  `Rules:\n` +
  `- The SEARCH section must match the current script EXACTLY (whitespace, indentation)\n` +
  `- Include enough surrounding context lines (3-5 lines) to make each SEARCH unique\n` +
  `- Output multiple blocks for multiple changes\n` +
  `- To delete code, leave the replacement section empty (nothing between ======= and >>>>>>> REPLACE)\n` +
  `- Do NOT output the full script — only the changing blocks\n` +
  `- Do NOT include explanations, commentary, or markdown outside of the blocks\n` +
  `- Do NOT use ======= or <<<<<<< or >>>>>>> inside your replacement code`;

// ── Types ──────────────────────────────────────────────────────

export interface DeveloperPassConfig {
  devConfig: { model: string; thinking: boolean; timeout: number | null };
  devSystemPrompt: string;
  devToolDefs: ToolDefinition[];
  objectiveDescription: string;
  pluginContext: string;
  plannerContext?: string;
  currentScript: string;
  toolArgs: Record<string, unknown>;
  isEditOperation: boolean;
  usePatchMode: boolean;
  attempt: number;
  maxAttempts: number;
  lastReviewIssues: string[];
  lastReviewSummary: string;
  lastExecutionError: string | null;
  reviewHistory: { attempt: number; issues: string[] }[];
  bannedAPIs: Set<string>;
  installedVersionInfo: string | null;
  language: string;
  toolName: string;
  pluginName: string;
  runId: string;
  recordStep: RecordStepFn;
  signal?: AbortSignal;
}

export interface DeveloperPassResult {
  script: string;
  succeeded: boolean;
  patchApplied: { appliedCount: number; failedCount: number } | null;
  /** Syntax error (code didn't compile) — skip execution */
  syntaxError: string | null;
  /** Execution error from running the plugin */
  executionError: string | null;
  /** Output files produced by execution */
  executionOutputFiles: string[];
  /** Test inputs used for execution */
  testInputs: Record<string, unknown>;
  /** New APIs to ban (extracted from errors) */
  newBannedAPIs: string[];
}

// ── Developer Pass ─────────────────────────────────────────────

/**
 * Run a single developer pass: build prompt → tool loop → extract/patch code → validate → execute.
 */
export async function runDeveloperPass(config: DeveloperPassConfig): Promise<DeveloperPassResult> {
  const {
    devConfig, devSystemPrompt, devToolDefs,
    objectiveDescription, pluginContext, plannerContext,
    currentScript, toolArgs, isEditOperation, usePatchMode,
    attempt, maxAttempts, lastReviewIssues, lastReviewSummary,
    lastExecutionError, reviewHistory, bannedAPIs, installedVersionInfo,
    language, toolName, pluginName, runId, recordStep, signal,
  } = config;

  const newBannedAPIs: string[] = [];

  // ── Build developer prompt ──
  const devUserPromptParts = [
    `## Objective\n${objectiveDescription}`,
    pluginContext,
  ];

  // Planner context — reasoning/analysis from earlier agents
  if (plannerContext && attempt === 1) {
    devUserPromptParts.push(`## Analysis\n\n${plannerContext}`);
  }

  // Patch mode vs full rewrite — prompt structure
  if (isEditOperation && attempt === 1) {
    // Edit-plugin: always patch mode on attempt 1
    devUserPromptParts.push(`\n## Current Script\n\n${currentScript}`);
    devUserPromptParts.push(
      `## Output Format — PATCH MODE\n\n` +
      `This is an EDIT to an existing, working plugin. You MUST output ONLY search/replace blocks — do NOT rewrite the full script.\n` +
      `For each change, output a block in this exact format:\n\n` +
      PATCH_FORMAT_BLOCK + `\n\n` +
      PATCH_RULES + `\n` +
      `- PRESERVE all existing functionality — only change what the spec requires`,
    );
  } else {
    // Include reviewer feedback if available
    if (lastReviewIssues.length > 0) {
      devUserPromptParts.push(
        `## Reviewer Feedback (Attempt ${attempt - 1})\n\nThe following issues were found:\n${lastReviewIssues.map((iss, i) => `${i + 1}. ${iss}`).join("\n")}\n\nSummary: ${lastReviewSummary}`,
      );
    }

    // Cumulative review feedback — prevents whack-a-mole regressions
    if (reviewHistory.length >= 2) {
      const latestIssues = reviewHistory[reviewHistory.length - 1].issues;
      const previousReviews = reviewHistory.slice(0, -1);

      const extractReqKey = (issue: string): string => {
        const match = issue.match(/REQUIREMENT:\s*([^|]+)/i);
        return match ? match[1].trim().toLowerCase() : issue.slice(0, 80).toLowerCase();
      };

      const latestKeys = latestIssues.map(extractReqKey);
      const previousKeys = new Set(previousReviews.flatMap((r) => r.issues.map(extractReqKey)));
      const persistentIssues = latestIssues.filter((_, idx) => previousKeys.has(latestKeys[idx]));

      const latestKeySet = new Set(latestKeys);
      const resolvedIssues: string[] = [];
      const resolvedKeys = new Set<string>();
      for (const prev of previousReviews) {
        for (const iss of prev.issues) {
          const key = extractReqKey(iss);
          if (!latestKeySet.has(key) && !resolvedKeys.has(key)) {
            resolvedIssues.push(iss);
            resolvedKeys.add(key);
          }
        }
      }

      const cumulativeParts: string[] = [];
      if (persistentIssues.length > 0) {
        cumulativeParts.push(
          `### PERSISTENT ISSUES (unfixed across ${reviewHistory.length} reviews — TOP PRIORITY)\n${persistentIssues.map((iss, i) => `${i + 1}. ${iss}`).join("\n")}`,
        );
      }
      if (resolvedIssues.length > 0) {
        cumulativeParts.push(
          `### PREVIOUSLY FIXED (DO NOT REGRESS — these were working)\n${resolvedIssues.map((iss, i) => `${i + 1}. ${iss}`).join("\n")}`,
        );
      }
      if (cumulativeParts.length > 0) {
        devUserPromptParts.push(`## Cumulative Review History\n\n${cumulativeParts.join("\n\n")}`);
      }
    }

    // Include execution error if the plugin crashed
    if (lastExecutionError) {
      devUserPromptParts.push(
        `## Execution Error\n\nThe plugin failed to execute with this error:\n\`\`\`\n${lastExecutionError}\n\`\`\`\n\nFix the code so it runs successfully.`,
      );
    }
    devUserPromptParts.push(`\n## Current Script\n\n${currentScript}`);
    if (usePatchMode) {
      devUserPromptParts.push(
        `## Output Format — PATCH MODE\n\n` +
        `You MUST output ONLY search/replace blocks — do NOT rewrite the full script.\n` +
        `For each change, output a block in this exact format:\n\n` +
        PATCH_FORMAT_BLOCK + `\n\n` +
        PATCH_RULES,
      );
    } else {
      devUserPromptParts.push(
        `## Output Format\n\nOutput the COMPLETE improved script. Your entire response must be the runnable code — no explanations, no markdown fences.`,
      );
    }
  }

  // Inject banned APIs warning
  if (bannedAPIs.size > 0) {
    devUserPromptParts.push(
      `## BANNED APIs — DO NOT USE\n\nThe following APIs/attributes/arguments DO NOT EXIST in the installed library versions. Using them WILL crash the plugin.\n${[...bannedAPIs].map((a) => `- \`${a}\` — DOES NOT EXIST, do NOT use`).join("\n")}\n\nYou MUST find alternative approaches that avoid ALL of the above.`,
    );
  }

  // Inject installed version info if available
  if (installedVersionInfo) {
    devUserPromptParts.push(installedVersionInfo);
  }

  createLog("debug", "developer", `Developer pass ${attempt}/${maxAttempts}`, { toolName, pluginName, bannedAPIs: [...bannedAPIs] }, runId).catch(() => {});

  // ── Developer tool-calling loop ──
  const devMessages: ChatMessage[] = [
    { role: "system", content: devSystemPrompt },
    { role: "user", content: devUserPromptParts.join("\n\n") },
  ];
  const themeKitOn = (await getSetting("theme_kit_enabled", "true")) === "true";
  const MAX_DEV_TOOL_CALLS = themeKitOn ? 10 : 8;
  let devToolCalls = 0;

  let devFinalContent: string | null = null;
  while (devToolCalls < MAX_DEV_TOOL_CALLS) {
    if (signal?.aborted) break;

    const devResponse = await callOpenRouterWithRetry({
      model: devConfig.model,
      messages: devMessages,
      tools: devToolDefs,
      stream: false,
      thinking: devConfig.thinking,
      meta: { agentId: "developer", runId },
    }, { signal, timeout: (devConfig.timeout ?? 120) * 1000 });

    // No tool calls → final response is the code
    if (!devResponse.toolCalls || devResponse.toolCalls.length === 0) {
      devFinalContent = devResponse.content ?? null;
      break;
    }

    // Push assistant message with tool calls
    devMessages.push({
      role: "assistant",
      content: devResponse.content ?? "",
      tool_calls: devResponse.toolCalls.map((dtc) => ({
        id: dtc.id,
        type: "function" as const,
        function: dtc.function,
      })),
    });

    // Process developer tool calls
    for (const dtc of devResponse.toolCalls) {
      devToolCalls++;
      let dtcArgs: Record<string, unknown> = {};
      try { dtcArgs = JSON.parse(dtc.function.arguments); } catch {
        createLog("warn", "orchestrator", `Failed to parse developer tool args for ${dtc.function.name}`, { raw: dtc.function.arguments?.slice(0, 200) }, runId).catch(() => {});
      }

      await recordStep("tool_call", {
        toolCallId: dtc.id,
        name: dtc.function.name,
        arguments: dtcArgs,
        agent: "developer",
      });

      let dtcResult: string;
      try {
        const toolResult = await executeTool(dtc.function.name, dtcArgs, {
          objectiveId: "",
          runId,
          agentId: "developer",
          signal,
        });
        dtcResult = JSON.stringify(toolResult.output ?? toolResult.error);
      } catch (dtcErr) {
        dtcResult = JSON.stringify({ error: dtcErr instanceof Error ? dtcErr.message : String(dtcErr) });
      }

      // Inject remaining budget warning
      const budgetRemaining = MAX_DEV_TOOL_CALLS - devToolCalls;
      if (budgetRemaining <= 1) {
        dtcResult += `\n\n[SYSTEM: You have ${budgetRemaining} tool call(s) remaining. After that, you MUST produce your final complete script code. Do NOT make another research call — write the code NOW.]`;
      }

      await recordStep("tool_result", {
        toolCallId: dtc.id,
        name: dtc.function.name,
        result: dtcResult.slice(0, 2000),
        agent: "developer",
      });

      devMessages.push({
        role: "tool",
        tool_call_id: dtc.id,
        content: dtcResult,
      });
    }
  }

  // ── Forced final call — if tool budget exhausted without producing code ──
  if (!devFinalContent && !signal?.aborted) {
    createLog("warn", "developer", `Tool budget exhausted (${devToolCalls} calls) without producing code — forcing final call`, { toolName, pluginName, attempt }, runId).catch(() => {});

    devMessages.push({
      role: "user",
      content: usePatchMode
        ? "Your tool call budget is exhausted. You MUST now produce search/replace blocks to fix the issues. Output ONLY <<<<<<< SEARCH / ======= / >>>>>>> REPLACE blocks — no explanations, no full script."
        : "Your tool call budget is exhausted. You MUST now produce the complete, final script code. Output ONLY the executable code — no explanations, no markdown fences, no tool calls. Your entire response must be the runnable script.",
    });

    const forcedResponse = await callOpenRouterWithRetry({
      model: devConfig.model,
      messages: devMessages,
      stream: false,
      thinking: devConfig.thinking,
      meta: { agentId: "developer", runId },
    }, { signal, timeout: (devConfig.timeout ?? 120) * 1000 });

    devFinalContent = forcedResponse.content ?? null;
  }

  // ── Apply code output (patch or full rewrite) ──
  let resultScript = currentScript;
  let patchApplied: { appliedCount: number; failedCount: number } | null = null;

  if (devFinalContent) {
    if (usePatchMode) {
      const patchResult = applySearchReplaceBlocks(currentScript, devFinalContent);
      if (patchResult && patchResult.appliedCount > 0) {
        resultScript = patchResult.script;
        patchApplied = { appliedCount: patchResult.appliedCount, failedCount: patchResult.failedCount };
        createLog("info", "developer", `Patch mode: ${patchResult.appliedCount} applied, ${patchResult.failedCount} failed`, {
          applied: patchResult.appliedCount,
          failed: patchResult.failedCount,
          failures: patchResult.failures,
        }, runId).catch(() => {});
      } else {
        // Patch failed (marker leakage or no matches). If patchResult is null
        // the developer output contains conflict markers — extracting code from
        // it would inject =======  into the script. Keep current script instead.
        if (!patchResult) {
          createLog("warn", "developer", `Patch mode: marker leakage detected — keeping current script`, {}, runId).catch(() => {});
        } else {
          // patchResult exists but 0 applied — try full rewrite as fallback
          resultScript = extractCode(devFinalContent, language);
          createLog("warn", "developer", `Patch mode: 0 patches applied — falling back to full rewrite`, {
            applied: patchResult.appliedCount,
            failed: patchResult.failedCount,
          }, runId).catch(() => {});
        }
      }
    } else {
      resultScript = extractCode(devFinalContent, language);
    }
  }

  // Safety net: reject scripts with leaked conflict markers (any path)
  if (resultScript !== currentScript && /^<{7}\s*SEARCH|^={7,}\s*$|^>{7}\s*REPLACE/m.test(resultScript)) {
    createLog("warn", "developer", `Post-extraction: conflict markers in script — reverting to current script`, {}, runId).catch(() => {});
    resultScript = currentScript;
  }

  // Unchanged script detection — compare against currentScript (the latest version),
  // not toolArgs.script (the original), so retries are also caught.
  if (resultScript === currentScript && devFinalContent) {
    createLog("warn", "developer", `Developer pass ${attempt} produced UNCHANGED script`, { toolName, pluginName, attempt, devToolCalls }, runId).catch(() => {});
  }

  await recordStep("developer_enhancement", {
    agent: "developer",
    model: devConfig.model,
    thinking: devConfig.thinking,
    toolName,
    pluginName,
    originalLength: (toolArgs.script as string).length,
    improvedLength: resultScript.length,
    attempt,
    totalAttempts: maxAttempts,
    patchMode: usePatchMode,
    patchesApplied: patchApplied?.appliedCount ?? 0,
    patchesFailed: patchApplied?.failedCount ?? 0,
  });

  // ── Syntax validation ──
  const syntaxError = await validateSyntax(resultScript, language);
  if (syntaxError) {
    const isLine1Error = /line 1/i.test(syntaxError);
    const preambleHint = isLine1Error
      ? "\n\nIMPORTANT: This error is on LINE 1, which suggests your response started with English text instead of code. Your ENTIRE response must be executable code — no preamble, no commentary, no \"Here's the code:\" text. The very first character must be part of the script (e.g., 'import', '#', 'def')."
      : "";
    const fullSyntaxError = `SYNTAX ERROR (code did not even compile):\n${syntaxError}${preambleHint}`;

    for (const api of extractBannedAPIs(syntaxError)) newBannedAPIs.push(api);
    createLog("warn", "orchestrator", `Syntax validation failed (attempt ${attempt}): ${syntaxError.slice(0, 200)}`, { toolName, pluginName, attempt }, runId).catch(() => {});

    await recordStep("pipeline_execution", {
      pluginName,
      success: false,
      error: `Syntax error: ${syntaxError.slice(0, 500)}`,
      outputFiles: [],
      syntaxCheckFailed: true,
    });

    return {
      script: resultScript,
      succeeded: true, // dev pass itself succeeded (produced code), but syntax failed
      patchApplied,
      syntaxError: fullSyntaxError,
      executionError: null,
      executionOutputFiles: [],
      testInputs: {},
      newBannedAPIs,
    };
  }

  // ── Execute plugin ──
  const testInputs = generateSampleInputs(toolArgs.inputSchema) ?? {};

  createLog("debug", "orchestrator", `Pipeline execution attempt ${attempt}`, {
    toolName, pluginName,
    testInputKeys: Object.keys(testInputs),
  }, runId).catch(() => {});

  const execResult = await executePluginInPipeline(
    toolArgs,
    resultScript,
    testInputs,
    runId,
    recordStep,
    signal,
  );

  if (!execResult.success) {
    const execError = execResult.error ?? "Unknown execution error";
    for (const api of extractBannedAPIs(execError)) newBannedAPIs.push(api);
    createLog("warn", "orchestrator", `Pipeline execution failed: ${execError}`, { toolName, attempt, bannedAPIs: [...bannedAPIs, ...newBannedAPIs] }, runId).catch(() => {});

    return {
      script: resultScript,
      succeeded: true,
      patchApplied,
      syntaxError: null,
      executionError: execError,
      executionOutputFiles: [],
      testInputs,
      newBannedAPIs,
    };
  }

  return {
    script: resultScript,
    succeeded: true,
    patchApplied,
    syntaxError: null,
    executionError: null,
    executionOutputFiles: execResult.outputFiles,
    testInputs,
    newBannedAPIs,
  };
}
