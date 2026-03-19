/**
 * Agent loop: iterative LLM call + tool execution cycle
 */

import { prisma } from "@/lib/db/prisma";
import type { ChatMessage, ToolDefinition } from "@/lib/openrouter/client";
import { callOpenRouterWithRetry } from "@/lib/openrouter/retry";
import { executeTool } from "@/lib/tools/executor";
import { createLog } from "@/lib/logs/logger";
import { toAbsolutePath } from "@/lib/workspace";
import { promises as fs } from "node:fs";
import { createAgentLoopState, type AgentLoopState } from "./schemas";
import { CODE_TOOL_NAMES, MAX_PIPELINES_PER_RUN } from "./phase-machine";
import { addToolResult, addPipelineContext, addGuardrailWarning, addNudge, pruneStaleSnapshots } from "./message-builder";
import { runCodePipeline } from "./code-pipeline";
import { validateSyntax } from "./pipeline-subprocess";
import { sanitizeAgentOutput } from "./pipeline-utils";
import type { RunContactProfile } from "@/lib/extensions/contacts";
import {
  ADMIN_TOOLS,
  evaluateToolGates,
  verifyOutputClaims,
  sanitizeFalseClaims,
  isSearchTool,
  isSearchResultThin,
  extractUrls,
  findUngroundedUrls,
  sanitizeUngroundedUrls,
} from "./agent-gates";

// Tools where the model controls the content — output just echoes model-supplied
// data back. URLs in their output are NOT independent evidence of grounding.
const ECHO_TOOLS = new Set(["save-result", "file-write", "advance-phase"]);


// Loop detection thresholds
const LOOP_BUFFER_SIZE = 6;
const LOOP_THRESHOLD = 3;
const LOOP_FORCE_STOP = 3;

// Browser progress check interval
const BROWSER_PROGRESS_CHECK_INTERVAL = 15;

// Pre-compiled patterns for response processing (called every iteration)
const WHITESPACE_STRIP_RE = /[-\s]/g;
const UNDERSCORE_RE = /_/g;
const HYPHEN_RE = /-/g;
const PIPELINE_PREFIX_RE = /^_pipeline_/;

export interface AgentCallConfig {
  agentId: string;
  model: string;
  thinking: boolean;
  timeout: number; // milliseconds
  messages: ChatMessage[];
  tools: ToolDefinition[];
  dbTools: Array<{ id: string; name: string; description: string; inputSchema: string; memory?: string | null; type?: string }>;
  /** Names of plugin-type tools (for claim verification — plugins can produce files) */
  pluginNames?: Set<string>;
  /** Pre-loaded agent configs — avoids redundant DB queries in the code pipeline. */
  agentConfigMap?: Map<string, { id: string; model: string; systemPrompt: string; thinking: boolean; timeout: number | null; imageModel?: string | null; fileModel?: string | null; audioModel?: string | null; videoModel?: string | null }>;
  maxIterations: number;
  /** When true, the message is purely conversational — respond once, no tool loop */
  isConversational?: boolean;
  context: { objectiveId: string; runId: string; objectiveDescription?: string; contactId?: string };
  contactProfile?: RunContactProfile;
  signal?: AbortSignal;
  recordStep: (type: string, content: unknown, toolId?: string) => Promise<void>;
  onDelta: (text: string) => void | Promise<void>;
  onInterimText?: (text: string) => Promise<void>;
}

export async function callAgent(config: AgentCallConfig): Promise<{ cancelled: boolean; agentRawText: string | null }> {
  const { messages } = config;
  const state = createAgentLoopState();

  // Secret values filled via use-secret — scrubbed from all tool results.
  const filledSecrets = new Set<string>();
  // Cached secret redaction regex — rebuilt only when new secrets are added.
  let cachedSecretsRe: RegExp | null = null;
  let lastSecretCount = 0;

  // Guardrail thresholds (no hard caps — smart guardrails handle problems).
  const CONSECUTIVE_FAIL_WARN = 3;
  const CONSECUTIVE_FAIL_STOP = 5;

  // Pre-compute tool ID lookup map (avoids O(n) find on every tool call).
  const dbToolMap = new Map(config.dbTools.map((t) => [t.name, t]));

  for (let i = 0; i < config.maxIterations; i++) {
    if (config.signal?.aborted) {
      await config.recordStep("cancelled", { message: "Stopped by user", agent: config.agentId });
      return { cancelled: true, agentRawText: null };
    }

    // After loop force-stop, strip tools to advance-phase only.
    // After pipeline failure, strip code tools to prevent retry loops.
    // After tab-cycle detection, strip browser tools to force synthesis.
    // After consecutive-fail-stop, strip the failing tool to prevent further retries.
    let iterationTools = config.tools;
    if (state.loopWarningCount >= 3) {
      iterationTools = config.tools.filter(
        (t) => t.function.name === "advance-phase"
      );
    } else if (state.failingToolToStrip) {
      iterationTools = config.tools.filter(
        (t) => t.function.name !== state.failingToolToStrip
      );
    } else if (state.tabCycleNudgeFired) {
      iterationTools = config.tools.filter(
        (t) => !t.function.name.startsWith("chrome-")
      );
    } else if (state.pipelineFailed) {
      iterationTools = config.tools.filter(
        (t) => !CODE_TOOL_NAMES.has(t.function.name)
      );
    }
    const response = await callOpenRouterWithRetry({
      model: config.model,
      messages,
      tools: iterationTools.length > 0 ? iterationTools : undefined,
      stream: false,
      thinking: config.thinking,
      meta: { agentId: config.agentId, runId: config.context.runId },
    }, { signal: config.signal, timeout: config.timeout });

    // Record reasoning for step viewer (user text emitted after agent finishes)
    if (response.content || response.reasoning) {
      await config.recordStep("reasoning", {
        text: response.content || "",
        thinking: response.reasoning || "",
        agent: config.agentId,
      });
      // Prefer the LONGEST substantive text (short throwaway text shouldn't overwrite).
      WHITESPACE_STRIP_RE.lastIndex = 0;
      const stripped = (response.content || "").replace(WHITESPACE_STRIP_RE, "");
      if (response.content && stripped.length > 10) {
        state.responseCount++;
        const existingLen = (state.agentRawText || "").length;
        if (response.content.length >= existingLen) {
          state.agentRawText = response.content;
        }
      }
    }

    // Normalize tool names: some models use underscores instead of hyphens.
    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        if (!tc.function.name.startsWith("zapier_")) {
          UNDERSCORE_RE.lastIndex = 0;
          tc.function.name = tc.function.name.replace(UNDERSCORE_RE, "-");
        }
      }
    }

    // Response-count guardrail: 3+ responses means looping — force conclusion.
    if (state.responseCount >= 3 && response.toolCalls && response.toolCalls.length > 0) {
      const hasAdvancePhase = response.toolCalls.some((tc) => tc.function.name === "advance-phase");
      if (!hasAdvancePhase) {
        createLog("warn", "orchestrator", `Response-count guardrail: ${state.responseCount} responses generated, forcing conclusion`, {}, config.context.runId).catch(() => {});
        messages.push({
          role: "system",
          content: "You have already generated multiple complete responses. STOP calling tools and call advance-phase NOW to complete the task. Do not start over or regenerate your response.",
        });
      }
    }

    // No tool calls: let it breathe (1st), nudge (2nd/3rd), break (4th).
    if (!response.toolCalls || response.toolCalls.length === 0) {
      if (config.tools.length === 0 || !response.content) {
        break; // No tools available or empty response — genuinely done
      }

      // Conversational messages need a single response — no nudging/looping
      if (config.isConversational) {
        break;
      }

      state.nudgeCount++;

      if (state.nudgeCount >= 4) {
        // Model is stuck — break and let generateClosingMessage handle it
        break;
      }

      if (state.nudgeCount === 1) {
        // First text-only: let it breathe — just add the text and continue.
        // The model will see its own narration and often self-corrects.
        messages.push({
          role: "assistant",
          content: response.content,
          ...(response.reasoning ? { reasoning: response.reasoning } : {}),
        });
      } else {
        // 2nd/3rd: nudge with increasing urgency
        addNudge(messages, config.agentId, response.content, response.reasoning);
      }
      continue;
    }

    // Model used tools — reset consecutive text-only counter
    state.nudgeCount = 0;

    // Emit interim text on the FIRST text+tools iteration only (acknowledgment).
    if (response.content && config.onInterimText && !state.interimEmitted) {
      const hasSubstantiveTools = response.toolCalls!.some(
        (tc) => tc.function.name !== "advance-phase"
      );
      if (hasSubstantiveTools) {
        const sanitized = sanitizeAgentOutput(response.content);
        WHITESPACE_STRIP_RE.lastIndex = 0;
        const stripped = sanitized.replace(WHITESPACE_STRIP_RE, "");
        if (stripped.length > 10) {
          state.interimEmitted = true;
          await config.onInterimText(sanitized);
        }
      }
    }

    // Build assistant message with tool_calls (includes reasoning for CoT preservation)
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: response.content ?? "",
      reasoning: response.reasoning,
      tool_calls: response.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: tc.function,
      })),
    };
    messages.push(assistantMessage);

    // Execute each tool call
    let phaseAdvanced = false;

    for (const tc of response.toolCalls) {
      // Check for cancellation before each tool call
      if (config.signal?.aborted) {
        await config.recordStep("cancelled", { message: "Stopped by user", agent: config.agentId });
        return { cancelled: true, agentRawText: null };
      }

      state.totalToolCalls++;
      state.toolNamesUsed.add(tc.function.name);
      if (!ADMIN_TOOLS.has(tc.function.name)) {
        state.substantiveToolCalls++;
      }

      let toolArgs: Record<string, unknown>;
      try {
        toolArgs = JSON.parse(tc.function.arguments);
      } catch {
        toolArgs = {};
        createLog("warn", "orchestrator", `Failed to parse tool args for ${tc.function.name}`, { raw: tc.function.arguments?.slice(0, 200) }, config.context.runId).catch(() => {});
      }

      const matchingTool = dbToolMap.get(tc.function.name);

      // Record tool call step
      await config.recordStep(
        "tool_call",
        {
          toolCallId: tc.id,
          name: tc.function.name,
          arguments: toolArgs,
          agent: config.agentId,
        },
        matchingTool?.id
      );

      // ── Code pipeline: Developer → Reviewer ──
      let skipPipeline = false;
      let pipelineWarning: string | null = null;
      let pipelinePassedHint: string | null = null;
      if (tc.function.name === "create-plugin" && toolArgs.name) {
        const exactName = toolArgs.name as string;
        HYPHEN_RE.lastIndex = 0;
        UNDERSCORE_RE.lastIndex = 0;
        const altName = exactName.includes("-")
          ? exactName.replace(HYPHEN_RE, "_")
          : exactName.replace(UNDERSCORE_RE, "-");
        const existing = await prisma.tool.findFirst({
          where: { name: { in: [exactName, altName] } },
        });
        if (existing) skipPipeline = true;
      }
      // Skip if pipeline budget exhausted (use cached count — avoids DB query per code tool call)
      if (!skipPipeline && CODE_TOOL_NAMES.has(tc.function.name)) {
        if (state.pipelineCount >= MAX_PIPELINES_PER_RUN) {
          skipPipeline = true;
          pipelineWarning = [
            `\n\n--- PIPELINE BUDGET EXHAUSTED ---`,
            `This run has already executed ${state.pipelineCount} full pipeline cycle(s) (max ${MAX_PIPELINES_PER_RUN}).`,
            `The plugin script was saved directly without the developer→reviewer pipeline.`,
            `If the output still has quality issues, please start a new conversation to try a fresh approach.`,
            `---`,
          ].join('\n');
          createLog("warn", "orchestrator", `Pipeline budget exhausted: ${state.pipelineCount}/${MAX_PIPELINES_PER_RUN} cycles used`, { toolName: tc.function.name }, config.context.runId).catch(() => {});
        }
      }
      // Normalize "code" → "script" alias
      if (CODE_TOOL_NAMES.has(tc.function.name) && !toolArgs.script && toolArgs.code) {
        toolArgs.script = toolArgs.code;
        delete toolArgs.code;
      }
      if (!skipPipeline && CODE_TOOL_NAMES.has(tc.function.name) && toolArgs.script && config.context.objectiveDescription) {
        // For edit-plugin: read the ACTUAL current script from disk (not executor's rewrite).
        if (tc.function.name === "edit-plugin" && toolArgs.name) {
          try {
            // Single query with OR for exact name + normalized name (hyphen ↔ underscore)
            HYPHEN_RE.lastIndex = 0;
            UNDERSCORE_RE.lastIndex = 0;
            const exactName = toolArgs.name as string;
            const altName = exactName.includes("-")
              ? exactName.replace(HYPHEN_RE, "_")
              : exactName.replace(UNDERSCORE_RE, "-");
            const existingTool = await prisma.tool.findFirst({
              where: { type: "plugin", name: { in: [exactName, altName] } },
            });
            if (existingTool && existingTool.name !== exactName) {
              toolArgs.name = existingTool.name; // Fix the name to match DB
            }
            if (existingTool) {
              const pluginConfig = JSON.parse(existingTool.config) as { scriptPath: string; language?: string; dependencies?: string[] };
              // Inject language, deps, and inputSchema from DB so the pipeline uses the correct ones
              if (pluginConfig.language && !toolArgs.language) toolArgs.language = pluginConfig.language;
              if (pluginConfig.dependencies?.length && !toolArgs.dependencies) toolArgs.dependencies = pluginConfig.dependencies;
              if (existingTool.inputSchema && !toolArgs.inputSchema) {
                try { toolArgs.inputSchema = JSON.parse(existingTool.inputSchema); } catch { /* skip */ }
              }

              const diskScript = await fs.readFile(toAbsolutePath(pluginConfig.scriptPath), "utf-8");
              if (diskScript && diskScript.length > 0) {
                // If the disk script has a syntax error, the executor's version is likely a fix — don't override
                const lang = pluginConfig.language ?? (toolArgs.language as string) ?? "python";
                const syntaxErr = await validateSyntax(diskScript, lang);
                if (syntaxErr) {
                  createLog("warn", "orchestrator", `edit-plugin: disk script has syntax error — keeping executor's fixed version`, {
                    diskLength: diskScript.length,
                    executorLength: (toolArgs.script as string).length,
                    syntaxError: syntaxErr.substring(0, 200),
                  }, config.context.runId).catch(() => {});
                } else {
                  createLog("info", "orchestrator", `edit-plugin: using disk script (${diskScript.length} chars) instead of executor script (${(toolArgs.script as string).length} chars)`, {
                    diskLength: diskScript.length,
                    executorLength: (toolArgs.script as string).length,
                  }, config.context.runId).catch(() => {});
                  toolArgs.script = diskScript;
                }
              }
            }
          } catch (err) {
            createLog("warn", "orchestrator", `edit-plugin: failed to read disk script, using executor script`, { error: (err as Error).message }, config.context.runId).catch(() => {});
          }
        }

        // Extract planner context for the pipeline (cached — same across code tool calls)
        if (!state.plannerContextResolved) {
          state.plannerContextResolved = true;
          try {
            const plannerSteps = await prisma.step.findMany({
              where: { runId: config.context.runId, type: { in: ["reasoning", "executor_summary"] } },
              orderBy: { sequence: "asc" },
              take: 5,
            });
            const planTexts: string[] = [];
            for (const ps of plannerSteps) {
              try {
                const parsed = JSON.parse(ps.content);
                if (parsed.text) planTexts.push(parsed.text);
              } catch { /* skip */ }
            }
            if (planTexts.length > 0) {
              state.cachedPlannerContext = planTexts.join("\n\n").slice(0, 6000);
            }
          } catch { /* ignore */ }
        }
        const plannerContext = state.cachedPlannerContext;

        const pipelineResult = await runCodePipeline(
          tc.function.name,
          toolArgs,
          config.context.objectiveDescription,
          config.context.runId,
          config.recordStep,
          plannerContext,
          config.signal,
          config.dbTools,
          config.agentConfigMap ? {
            developer: config.agentConfigMap.get("developer"),
            reviewer: config.agentConfigMap.get("reviewer"),
          } : undefined,
        );
        toolArgs = pipelineResult.toolArgs;
        state.pipelineCount++; // Increment cached count (pipeline records pipeline_summary step)

        // Build quality warning if reviews failed or pipeline completely failed
        if (!pipelineResult.reviewMeta) {
          const isCreditIssue = pipelineResult.creditsExhausted === true;
          pipelineWarning = [
            `\n\n--- PIPELINE FAILURE${isCreditIssue ? " (CREDITS EXHAUSTED)" : ""} ---`,
            `The code pipeline COMPLETELY FAILED — no code changes were made to the plugin.`,
            isCreditIssue
              ? `Your OpenRouter credits have been exhausted. All API calls failed with a 402 error.`
              : `All developer attempts errored (likely billing/rate limits). The original, unmodified script was saved.`,
            `Do NOT tell the user the changes were applied — they were NOT.`,
            isCreditIssue
              ? `Tell the user: "I couldn't complete this change because your OpenRouter credits have run out. Please add credits at openrouter.ai and try again."`
              : `Inform the user that the modification could not be completed due to pipeline errors and suggest they try again later.`,
            `IMPORTANT: Do NOT call any other tools. Report the failure to the user and call advance-phase immediately.`,
            `---`,
          ].join('\n');
        } else if (!pipelineResult.reviewMeta.passed) {
          const meta = pipelineResult.reviewMeta;
          pipelineWarning = [
            `\n\n--- PIPELINE QUALITY WARNING ---`,
            `The code pipeline reviewed this plugin ${meta.finalAttempt} time(s) and the final review did NOT pass.`,
            `Issues found:`,
            ...meta.lastIssues.map((iss, i) => `  ${i + 1}. ${iss}`),
            `Summary: ${meta.lastSummary}`,
            '',
            `The plugin was saved with the best available version, but the output may not fully meet the specification.`,
            `IMPORTANT: Do NOT call any other tools unrelated to this task. Report the result to the user and call advance-phase.`,
            `---`,
          ].filter(Boolean).join('\n');
        }

        // Pipeline PASSED — lock output and build hint
        if (pipelineResult.reviewMeta?.passed) {
          state.pipelineOutputLocked = true;

          // Promote pipeline_test artifacts to user-visible files.
          // Files stay in _pipeline_test/ on disk (cleanup removed from code-pipeline.ts).
          const pipelineArtifacts = await prisma.artifact.findMany({
            where: { runId: config.context.runId, category: "pipeline_test" },
          });
          if (pipelineArtifacts.length > 0) {
            await Promise.all(pipelineArtifacts.map((art) => {
              const cleanName = art.filename.replace(PIPELINE_PREFIX_RE, "");
              return prisma.artifact.update({
                where: { id: art.id },
                data: { intermediate: false, category: "file", filename: cleanName },
              });
            }));
          }

          const outputFilesList = (pipelineResult.pipelineOutputFiles ?? []).join(", ");
          const testInputsJson = JSON.stringify(pipelineResult.pipelineTestInputs ?? {});
          const isEdit = tc.function.name === "edit-plugin";

          const pluginName = toolArgs.name as string | undefined;
          pipelinePassedHint = [
            `\n\n--- PIPELINE PASSED ---`,
            `The code pipeline reviewed and APPROVED this plugin after ${pipelineResult.reviewMeta.finalAttempt} attempt(s).`,
            `Summary: ${pipelineResult.reviewMeta.lastSummary}`,
            outputFilesList ? `Output files already generated and tracked as artifacts: ${outputFilesList}` : '',
            outputFilesList ? `Test inputs used during validation: ${testInputsJson}` : '',
            outputFilesList
              ? `The pipeline already produced validated output file(s). The user can download them from the Outputs page. You do NOT need to re-generate them unless the user wants different parameters.`
              : '',
            isEdit
              ? `IMPORTANT: The pipeline may have added NEW input parameters to the plugin. When you re-run the plugin, use AT MINIMUM the test inputs shown above to ensure the new features work.`
              : '',
            pluginName
              ? `If you need to re-run the plugin, call it BY NAME as a tool: "${pluginName}" with the appropriate input parameters. Do NOT use run-snippet or subprocess to run it.`
              : '',
            `After confirming the output, call save-result and advance-phase to complete.`,
            `Do NOT create additional plugins or write files manually — the pipeline output is the validated version.`,
            `---`,
          ].filter(Boolean).join('\n');
        }
      }

      // ── Pre-execution gates (batch deferral, pipeline lock, zapier, empty-work,
      //    browser verification, claim verification, grounding) ──
      const gateBlocked = await evaluateToolGates({
        toolCallId: tc.id,
        toolName: tc.function.name,
        allToolCalls: response.toolCalls!.map((t) => ({ id: t.id, function: { name: t.function.name } })),
        agentId: config.agentId,
        runId: config.context.runId,
        messages,
        state,
        pluginNames: config.pluginNames,
        recordStep: config.recordStep,
      });
      if (gateBlocked) continue;

      // Execute the tool
      createLog("debug", "tool", `[${config.agentId}] Executing: ${tc.function.name}`, {
        arguments: toolArgs,
      }, config.context.runId).catch(() => {});

      const result = await executeTool(tc.function.name, toolArgs, {
        objectiveId: config.context.objectiveId,
        runId: config.context.runId,
        agentId: config.agentId,
        contactId: config.context.contactId,
        filledSecrets,
        signal: config.signal,
        recordStep: config.recordStep,
      }, matchingTool?.inputSchema);

      // Defense-in-depth: never leak vault values to LLM
      if (tc.function.name === "use-secret") {
        result.output = result.success
          ? { message: `Secret "${toolArgs.secretLabel ?? toolArgs.secret_label ?? ""}" applied successfully` }
          : result.output;
      }

      // ── Centralized secret redaction (cached regex, rebuilt only when secrets change) ──
      if (filledSecrets.size > 0) {
        // Rebuild regex only when new secrets have been added
        if (filledSecrets.size !== lastSecretCount) {
          lastSecretCount = filledSecrets.size;
          const escapedSecrets = [...filledSecrets]
            .filter((s) => s.length >= 4)
            .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
          cachedSecretsRe = escapedSecrets.length > 0
            ? new RegExp(escapedSecrets.join("|"), "g")
            : null;
        }
        if (cachedSecretsRe) {
          cachedSecretsRe.lastIndex = 0;
          const raw = JSON.stringify(result.output ?? "");
          const scrubbed = raw.replace(cachedSecretsRe, "[REDACTED]");
          if (scrubbed !== raw) {
            try { result.output = JSON.parse(scrubbed); } catch { /* keep original */ }
          }
          if (result.error) {
            cachedSecretsRe.lastIndex = 0;
            result.error = result.error.replace(cachedSecretsRe, "[REDACTED]");
          }
        }
      }

      // Surface pipeline quality failure prominently
      if (pipelineWarning) {
        const output = (result.output as Record<string, unknown>) ?? {};
        output._pipelineQualityFailed = true;
        result.output = output;
        state.pipelineFailed = true;
      }
      // ── Track browser tool usage ──
      if (tc.function.name.startsWith("chrome-")) {
        state.browserToolsUsed = true;
        state.browserToolCallCount++;
      }
      // Track tab selections for cycle detection
      if (tc.function.name === "chrome-select-tab" && toolArgs.pageId) {
        state.tabSelectHistory.push(String(toolArgs.pageId));
      }

      // ── Track Zapier config URL call — blocks subsequent skill/schedule creation ──
      if (tc.function.name === "zapier_get_configuration_url" && result.success) {
        state.zapierGuidanceGiven = true;
      }

      // ── Track create-skill — triggers auto-test nudge on advance-phase ──
      // Flag is only cleared by the one-shot gate in agent-gates.ts (not by tool calls).
      if (tc.function.name === "create-skill" && result.success) {
        state.skillCreatedNotTested = true;
      }

      // Consecutive failure tracking
      if (result.success) {
        state.consecutiveFailures = 0;
      } else {
        state.consecutiveFailures++;
        // Tool confusion hint: file-read with ENOENT → suggest file-write
        if (tc.function.name === "file-read" && typeof result.error === "string" && result.error.includes("ENOENT")) {
          result.error += "\n\nHint: If you are trying to CREATE or WRITE a file, use the `file-write` tool instead. `file-read` only reads existing files.";
        }
      }

      // Same-tool-name consecutive call tracking (catches loops with varying args)
      if (tc.function.name === state.consecutiveSameToolName) {
        state.consecutiveSameToolCount++;
      } else {
        state.consecutiveSameToolName = tc.function.name;
        state.consecutiveSameToolCount = 1;
      }

      // Record tool result step
      await config.recordStep(
        "tool_result",
        {
          toolCallId: tc.id,
          name: tc.function.name,
          result,
          agent: config.agentId,
        },
        matchingTool?.id
      );

      // Add tool result to conversation
      addToolResult(messages, tc.id, result.output ?? result.error);

      // ── Search tracking + URL collection ──
      // Track consecutive search calls with thin results (for search-pivot nudge).
      // Collect all URLs from tool results (for grounding gate).
      if (isSearchTool(tc.function.name)) {
        if (isSearchResultThin(result)) {
          state.consecutiveThinSearches++;
        } else {
          state.consecutiveThinSearches = 0;
        }
      } else {
        state.consecutiveThinSearches = 0; // non-search tool resets counter
      }
      // Accumulate URLs from tool results for grounding verification.
      // Exclude echo tools (module-level ECHO_TOOLS) whose output just
      // reflects model-supplied data — not independent grounding evidence.
      if (!ECHO_TOOLS.has(tc.function.name)) {
        const resultJson = JSON.stringify(result.output ?? "");
        for (const url of extractUrls(resultJson)) {
          state.toolResultUrls.add(url);
        }
      }

      // Inject pipeline context as SYSTEM messages (models don't echo these back)
      if (pipelineWarning) {
        addPipelineContext(messages, pipelineWarning);
      }
      if (pipelinePassedHint) {
        addPipelineContext(messages, pipelinePassedHint);
      }

      // Emit synthetic "result" step for save-result (for SSE)
      if (tc.function.name === "save-result" && result.success) {
        await config.recordStep("result", {
          data: toolArgs.data,
          summary: toolArgs.summary,
        });
      }

      // If advance-phase was called successfully, break after processing all tool calls
      if (tc.function.name === "advance-phase" && result.success) {
        phaseAdvanced = true;
      }
    }

    // ── Consecutive failures ──
    if (state.consecutiveFailures >= CONSECUTIVE_FAIL_STOP) {
      createLog("warn", "orchestrator", `[${config.agentId}] ${CONSECUTIVE_FAIL_STOP} consecutive failures — stopping`, {}, config.context.runId).catch(() => {});
      addGuardrailWarning(messages, "consecutive_fail_stop", { limit: CONSECUTIVE_FAIL_STOP });
      // Hard guardrail: strip the tool that's failing to prevent further retries
      if (state.consecutiveSameToolName && state.consecutiveSameToolName !== "advance-phase") {
        state.failingToolToStrip = state.consecutiveSameToolName;
        createLog("warn", "orchestrator", `[${config.agentId}] Stripping tool "${state.failingToolToStrip}" after ${CONSECUTIVE_FAIL_STOP} consecutive failures`, {}, config.context.runId).catch(() => {});
      }
    } else if (state.consecutiveFailures >= CONSECUTIVE_FAIL_WARN) {
      addGuardrailWarning(messages, "consecutive_fail_warn");
    }

    // ── Same-tool-name loop detection (catches varied-argument loops) ──
    if (state.consecutiveSameToolCount >= LOOP_THRESHOLD && state.consecutiveSameToolName !== "chrome-snapshot") {
      addGuardrailWarning(messages, "tool_loop");
      state.loopWarningCount++;
      state.consecutiveSameToolCount = 0; // Reset so warning fires once per burst
    }

    // ── Tool call loop detection (excludes chrome-snapshot) ──
    {
      for (const tc of response.toolCalls) {
        if (tc.function.name === "chrome-snapshot") continue;
        const sig = `${tc.function.name}:${JSON.stringify(tc.function.arguments ?? {})}`;
        state.recentToolSignatures.push(sig);
      }
      // Trim to ring buffer size
      if (state.recentToolSignatures.length > LOOP_BUFFER_SIZE) {
        state.recentToolSignatures = state.recentToolSignatures.slice(-LOOP_BUFFER_SIZE);
      }
      // Check if any signature appears >= threshold times
      const counts = new Map<string, number>();
      for (const s of state.recentToolSignatures) {
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
      for (const [, count] of counts) {
        if (count >= LOOP_THRESHOLD) {
          state.loopWarningCount++;
          if (state.loopWarningCount >= LOOP_FORCE_STOP) {
            // Force-stop: agent has ignored multiple loop warnings
            createLog("warn", "orchestrator", `[${config.agentId}] ${state.loopWarningCount} loop warnings — force-stopping`, {}, config.context.runId).catch(() => {});
            addGuardrailWarning(messages, "tool_loop_stop");
          } else {
            addGuardrailWarning(messages, "tool_loop");
          }
          // Clear buffer so the warning only fires once per loop
          state.recentToolSignatures = [];
          break;
        }
      }
    }

    // ── Search-to-source pivot nudge (fires at most once) ──
    if (state.consecutiveThinSearches >= 3 && !state.searchPivotNudgeFired) {
      state.searchPivotNudgeFired = true;
      createLog("warn", "orchestrator", `Search-pivot nudge: ${state.consecutiveThinSearches} consecutive thin search results`, {}, config.context.runId).catch(() => {});
      addGuardrailWarning(messages, "search_pivot");
    }

    // ── Tab-cycle detection (fires at most once) ──
    if (!state.tabCycleNudgeFired && state.tabSelectHistory.length >= 6) {
      const cycleLen = detectTabCycle(state.tabSelectHistory);
      if (cycleLen > 0) {
        state.tabCycleNudgeFired = true;
        createLog("warn", "orchestrator", `Tab-cycle detected: ${cycleLen} tabs cycled ${Math.floor(state.tabSelectHistory.length / cycleLen)} times`, {
          recentTabs: state.tabSelectHistory.slice(-cycleLen * 3),
        }, config.context.runId).catch(() => {});
        addGuardrailWarning(messages, "tab_cycle");
      }
    }

    // ── Periodic browser progress check ──
    if (state.browserToolsUsed && state.browserToolCallCount > 0 && state.browserToolCallCount % BROWSER_PROGRESS_CHECK_INTERVAL === 0) {
      messages.push({
        role: "system",
        content: `Progress checkpoint (${state.browserToolCallCount} browser actions so far): Pause and review the original objective. What have you completed? What specific items/steps remain? Do NOT skip any remaining items — continue until every requirement is met.`,
      });
    }

    // ── Prune stale browser snapshots (only when browser tools are active) ──
    if (state.browserToolsUsed) {
      const pruneResult = pruneStaleSnapshots(messages);
      if (pruneResult.prunedCount > 0) {
        await config.recordStep("context_pruned", {
          snapshotsRemoved: pruneResult.prunedCount,
          charsFreed: pruneResult.charsFreed,
          agent: config.agentId,
        });
      }
    }

    // Phase changed — stop agent, let coordinator dispatch next
    if (phaseAdvanced) {
      // No text yet — generate a closing summary.
      if (config.agentId === "executor" && !state.agentRawText) {
        await generateClosingMessage(config, state, messages);
      }
      break;
    }
  }

  // Generate closing summary if executor has no text output.
  if (config.agentId === "executor" && !state.agentRawText) {
    await generateClosingMessage(config, state, messages);
  }

  // ── Post-loop grounding gate — sanitize fabricated URLs when advance-phase was never called ──
  if (config.agentId === "executor" && state.agentRawText && !state.groundingGateFired) {
    const ungrounded = findUngroundedUrls(state.agentRawText, state.toolResultUrls);
    if (ungrounded.length >= 3) {
      state.groundingGateFired = true;
      createLog("warn", "orchestrator", `Post-loop grounding gate: sanitizing ${ungrounded.length} ungrounded URLs from output`, { sample: ungrounded.slice(0, 5) }, config.context.runId).catch(() => {});
      state.agentRawText = sanitizeUngroundedUrls(state.agentRawText, ungrounded);
    }
  }

  // ── Post-loop claim sanitization — strip false claims from final output ──
  // Runs unconditionally as last line of defense (in-loop gate may have fired but agent didn't fix)
  if (config.agentId === "executor" && state.agentRawText) {
    const unverifiedClaims = verifyOutputClaims(state.agentRawText, state.toolNamesUsed, config.pluginNames);
    if (unverifiedClaims.length > 0) {
      const claimList = unverifiedClaims.map((c) => c.claim).join(", ");
      createLog("warn", "orchestrator", `Post-loop claim sanitization: stripping false claims (${claimList}) from output`, {}, config.context.runId).catch(() => {});
      state.agentRawText = sanitizeFalseClaims(state.agentRawText, unverifiedClaims);
    }
  }

  return { cancelled: false, agentRawText: state.agentRawText };
}

/** Generate a closing summary message when the executor has no text output. */
async function generateClosingMessage(
  config: AgentCallConfig,
  state: AgentLoopState,
  messages: ChatMessage[],
): Promise<void> {
  messages.push({
    role: "system",
    content: "Now write a brief, friendly message to the user summarizing what you accomplished and what still needs to be done (if anything). Output ONLY the final chat message — no reasoning, no instructions, no meta-commentary.",
  });
  try {
    const closing = await callOpenRouterWithRetry({
      model: config.model,
      messages,
      stream: false,
      thinking: config.thinking,
      meta: { agentId: config.agentId, runId: config.context.runId },
    }, { signal: config.signal, timeout: config.timeout });
    if (closing.content) {
      state.agentRawText = sanitizeAgentOutput(closing.content);
      await config.recordStep("reasoning", {
        text: state.agentRawText,
        thinking: closing.reasoning || "",
        agent: config.agentId,
      });
    }
  } catch (closingErr) {
    if (config.signal?.aborted) throw closingErr;
    createLog("warn", "orchestrator", `Executor closing message failed: ${closingErr instanceof Error ? closingErr.message : String(closingErr)}`, {}, config.context.runId).catch(() => {});
  }
}

/**
 * Detect cyclic tab-switching patterns in the pageId history.
 * Returns the cycle length if the same set of tab IDs has been visited
 * 3+ complete times, or 0 if no cycle is detected.
 */
function detectTabCycle(history: string[]): number {
  const maxCycleLen = Math.floor(history.length / 3);
  for (let cycleLen = 2; cycleLen <= maxCycleLen; cycleLen++) {
    const recentSet = new Set(history.slice(-cycleLen));
    if (recentSet.size !== cycleLen) continue; // duplicates in window — not a clean cycle

    let completeCycles = 0;
    for (let start = history.length - cycleLen; start >= 0; start -= cycleLen) {
      const window = history.slice(start, start + cycleLen);
      const windowSet = new Set(window);
      if (windowSet.size !== recentSet.size) break;
      let match = true;
      for (const id of windowSet) {
        if (!recentSet.has(id)) { match = false; break; }
      }
      if (!match) break;
      completeCycles++;
    }

    if (completeCycles >= 3) return cycleLen;
  }
  return 0;
}
