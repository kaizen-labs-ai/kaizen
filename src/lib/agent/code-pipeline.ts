/**
 * Code pipeline: Developer → Execute → Conditional Review loop.
 *
 * Simplified pipeline: the developer agent handles research, planning,
 * and coding in one tool-calling loop. Review only fires for visual/
 * multimodal output (images, PDFs, audio). Text/JSON output auto-passes
 * when execution succeeds.
 */

import { prisma } from "@/lib/db/prisma";
import { InsufficientCreditsError, type ToolDefinition } from "@/lib/openrouter/client";
import { buildSystemPrompt } from "./prompt-builder";
import { createLog } from "@/lib/logs/logger";
import {
  type PipelineReviewMeta,
  createPipelineState,
} from "./schemas";
import {
  buildPluginContext,
  extractBannedAPIs,
} from "./pipeline-utils";
import { checkInstalledVersions } from "./pipeline-subprocess";
import { getToolsForAgent } from "./phase-machine";
import { inspectOutputFiles } from "@/lib/tools/output-inspector";

// ── Pipeline sub-modules ───────────────────────────────────────

import { runDeveloperPass } from "./pipeline-developer";
import { runReviewPhase } from "./pipeline-reviewer";

// ── Constants ──────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;

// ── Conditional review helper ──────────────────────────────────

/** Determine if the multimodal reviewer should be invoked. */
async function shouldInvokeReviewer(outputFiles: string[]): Promise<boolean> {
  if (outputFiles.length === 0) return false;
  const { primaryModality } = await inspectOutputFiles(outputFiles);
  // Only review visual/multimodal output — text/JSON auto-passes
  return primaryModality === "image" || primaryModality === "file"
    || primaryModality === "audio" || primaryModality === "video";
}

// ── Code Pipeline ──────────────────────────────────────────────

export async function runCodePipeline(
  toolName: string,
  toolArgs: Record<string, unknown>,
  objectiveDescription: string,
  runId: string,
  recordStep: (type: string, content: unknown, toolId?: string) => Promise<void>,
  plannerContext?: string,
  signal?: AbortSignal,
  /** Pre-loaded enabled tools — avoids redundant DB query when caller already has them. */
  preloadedTools?: Array<{ id: string; name: string; description: string; inputSchema: string }>,
  /** Pre-loaded agent configs — avoids redundant DB queries when caller already has them. */
  preloadedAgentConfigs?: { developer?: { id: string; model: string; systemPrompt: string; thinking: boolean; timeout: number | null }; reviewer?: { id: string; model: string; systemPrompt: string; thinking: boolean; timeout: number | null; imageModel?: string | null; fileModel?: string | null; audioModel?: string | null; videoModel?: string | null } },
): Promise<{ toolArgs: Record<string, unknown>; reviewMeta?: PipelineReviewMeta; pipelineOutputFiles?: string[]; pipelineTestInputs?: Record<string, unknown>; creditsExhausted?: boolean }> {
  if (!toolArgs.script) return { toolArgs };

  const pluginContext = buildPluginContext(toolArgs);
  const pluginName = (toolArgs.name as string) ?? "plugin";

  // Use pre-loaded configs when available, otherwise query DB in parallel
  const [devConfig, reviewerConfig] = preloadedAgentConfigs
    ? [preloadedAgentConfigs.developer, preloadedAgentConfigs.reviewer]
    : await Promise.all([
        prisma.agentConfig.findUnique({ where: { id: "developer" } }),
        prisma.agentConfig.findUnique({ where: { id: "reviewer" } }),
      ]);

  // Developer is required — without it, return original
  if (!devConfig) return { toolArgs };

  try {
    const ps = createPipelineState(toolArgs.script as string);

    if (signal?.aborted) return { toolArgs };

    // ── 0. CHECK INSTALLED VERSIONS ──────────────────────────
    const deps = Array.isArray(toolArgs.dependencies) ? (toolArgs.dependencies as string[]) : [];
    const language = (toolArgs.language as string) ?? "python";
    let installedVersionInfo: string | null = null;
    try {
      installedVersionInfo = await checkInstalledVersions(language, deps);
      if (installedVersionInfo) {
        createLog("debug", "orchestrator", `Checked installed versions for ${deps.length} deps`, { language, deps }, runId).catch(() => {});
      }
    } catch { /* version check is best-effort */ }

    // ── 1. DEVELOPER → EXECUTE → CONDITIONAL REVIEW LOOP ────
    const isEditOperation = toolName === "edit-plugin";

    if (signal?.aborted) return { toolArgs };

    const devSystemPrompt = await buildSystemPrompt({
      agentId: "developer",
      systemInstructions: devConfig.systemPrompt,
    });

    // Developer tools — use pre-loaded tools when available, otherwise query DB
    const devDbTools = preloadedTools ?? await prisma.tool.findMany({ where: { enabled: true } });
    const devAgentTools = getToolsForAgent("developer", devDbTools);
    const devToolDefs: ToolDefinition[] = devAgentTools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: JSON.parse(t.inputSchema),
      },
    }));

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (signal?.aborted) break;
      ps.lastAttempt = attempt;

      // Patch mode: attempts 2+ for create, always for edit
      const usePatchMode = isEditOperation ? true : attempt > 1;

      try {
        // ── Developer pass ──
        const devResult = await runDeveloperPass({
          devConfig,
          devSystemPrompt,
          devToolDefs,
          objectiveDescription,
          pluginContext,
          plannerContext,
          currentScript: ps.currentScript,
          toolArgs,
          isEditOperation,
          usePatchMode,
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          lastReviewIssues: ps.lastReviewIssues,
          lastReviewSummary: ps.lastReviewSummary,
          lastExecutionError: ps.lastExecutionError,
          reviewHistory: ps.reviewHistory,
          bannedAPIs: ps.bannedAPIs,
          installedVersionInfo,
          language,
          toolName,
          pluginName,
          runId,
          recordStep,
          signal,
        });

        ps.currentScript = devResult.script;
        ps.anyDevPassSucceeded = devResult.succeeded;
        ps.lastExecutionError = null;

        // Absorb new banned APIs
        for (const api of devResult.newBannedAPIs) ps.bannedAPIs.add(api);

        // Syntax error — skip execution, go to next attempt
        if (devResult.syntaxError) {
          ps.lastExecutionError = devResult.syntaxError;
          if (attempt === MAX_ATTEMPTS) break;
          continue;
        }

        // Execution error — feed to next attempt
        if (devResult.executionError) {
          ps.lastExecutionError = devResult.executionError;
          if (attempt === MAX_ATTEMPTS) break;
          continue;
        }

        ps.lastTestInputs = devResult.testInputs;
        ps.lastOutputFiles = devResult.executionOutputFiles;

        // ── Conditional review ──
        // Only invoke the multimodal reviewer for visual output (images, PDFs, audio, video).
        // Text/JSON output auto-passes — execution success IS the quality check.
        const needsReview = await shouldInvokeReviewer(devResult.executionOutputFiles);

        if (!needsReview || !reviewerConfig) {
          ps.lastReviewResult = { passed: true, issues: [], summary: "Auto-passed — execution succeeded" };
          ps.reviewSkipped = true;
          break;
        }

        const reviewResult = await runReviewPhase({
          reviewerConfig,
          objectiveDescription,
          pluginContext,
          currentScript: ps.currentScript,
          executionOutputFiles: devResult.executionOutputFiles,
          attempt,
          toolName,
          pluginName,
          runId,
          recordStep,
          signal,
          testInputs: devResult.testInputs,
        });

        // Review phase failed entirely — accept current script
        if (!reviewResult) break;

        // Track review result
        ps.lastReviewResult = {
          passed: reviewResult.passed,
          issues: reviewResult.issues,
          summary: reviewResult.summary,
        };
        ps.reviewHistory.push({ attempt, issues: reviewResult.issues });

        // If passed or all attempts exhausted, we're done
        if (reviewResult.passed || attempt === MAX_ATTEMPTS) break;

        // Store feedback for next developer pass
        ps.lastReviewIssues = reviewResult.issues;
        ps.lastReviewSummary = reviewResult.summary;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isCreditsExhausted = err instanceof InsufficientCreditsError;
        createLog("warn", "orchestrator", `Pipeline attempt ${attempt}/${MAX_ATTEMPTS} failed: ${errMsg}`, { toolName, pluginName, attempt, creditsExhausted: isCreditsExhausted }, runId).catch(() => {});

        await recordStep("developer_enhancement", {
          agent: "developer",
          model: devConfig.model,
          toolName,
          pluginName,
          attempt,
          totalAttempts: MAX_ATTEMPTS,
          failed: true,
          error: errMsg.slice(0, 500),
          creditsExhausted: isCreditsExhausted,
  
        }).catch(() => {});

        // Credit exhaustion — no point retrying
        if (isCreditsExhausted) {
          ps.hitCreditsError = true;
          break;
        }

        if (attempt < MAX_ATTEMPTS) {
          ps.lastExecutionError = errMsg;
          for (const api of extractBannedAPIs(errMsg)) ps.bannedAPIs.add(api);
          continue;
        }
        break;
      }
    }

    // NOTE: _pipeline_test/ cleanup removed — files are promoted to artifacts
    // by agent-loop.ts after runCodePipeline returns. Deleting here would
    // destroy files that artifacts reference. The run artifacts dir is cleaned
    // up as a whole when runs are purged.

    // ── Summary ────────────────────────────────────────────────
    if (!ps.anyDevPassSucceeded) {
      createLog("warn", "orchestrator", "Pipeline: all developer passes failed — returning original script", { toolName, pluginName, creditsExhausted: ps.hitCreditsError }, runId).catch(() => {});
      await recordStep("pipeline_summary", {
        pluginName,
        passed: false,
        allFailed: true,
        creditsExhausted: ps.hitCreditsError,
        totalAttempts: ps.lastAttempt,
        maxAttempts: MAX_ATTEMPTS,

        reviewSkipped: ps.reviewSkipped,
        lastIssues: [ps.hitCreditsError
          ? "OpenRouter credits exhausted — unable to generate or modify code"
          : "All developer passes failed — likely billing/rate limit errors"],
        lastSummary: ps.hitCreditsError
          ? "Pipeline aborted: no credits remaining on OpenRouter. Please add credits at openrouter.ai."
          : "Pipeline completely failed: no code changes were applied to the plugin.",
        reviewAttempts: 0,
      }).catch(() => {});
      return { toolArgs, creditsExhausted: ps.hitCreditsError };
    }

    await recordStep("pipeline_summary", {
      pluginName,
      passed: ps.lastReviewResult?.passed ?? null,
      totalAttempts: ps.lastAttempt,
      maxAttempts: MAX_ATTEMPTS,
      reviewSkipped: ps.reviewSkipped,
      lastIssues: ps.lastReviewResult?.issues ?? [],
      lastSummary: ps.lastReviewResult?.summary ?? "",
      reviewAttempts: ps.reviewHistory.length,
    }).catch(() => {});

    return {
      toolArgs: { ...toolArgs, script: ps.currentScript },
      reviewMeta: ps.lastReviewResult ? {
        passed: ps.lastReviewResult.passed,
        finalAttempt: ps.lastAttempt,
        totalAttempts: MAX_ATTEMPTS,
        lastIssues: ps.lastReviewResult.issues,
        lastSummary: ps.lastReviewResult.summary,

        reviewSkipped: ps.reviewSkipped,
      } : undefined,
      pipelineOutputFiles: ps.lastOutputFiles,
      pipelineTestInputs: ps.lastTestInputs,
    };
  } catch (err) {
    // Entire pipeline failed — clean up and return original
    createLog("warn", "developer", `Pipeline failed: ${err instanceof Error ? err.message : String(err)}`, { toolName }, runId).catch(() => {});
    return { toolArgs };
  }
}
