/**
 * Orchestrator finalize: fallback response generation, run completion, and error handling.
 * Extracted from orchestrator.ts to keep the main run coordinator focused on dispatch logic.
 */

import { prisma } from "@/lib/db/prisma";
import {
  callOpenRouter,
  InsufficientCreditsError,
  type ChatMessage,
} from "@/lib/openrouter/client";
import { buildSystemPrompt } from "./prompt-builder";
import { createLog } from "@/lib/logs/logger";
import type { OrchestratorCallbacks } from "./orchestrator";
import { OutputRouter } from "./output-router";

// ── Fallback Response ──────────────────────────────────────────

/**
 * Generate a fallback conversational response when no agent produced output.
 */
export async function generateFallbackResponse(params: {
  model: string;
  chatHistory: ChatMessage[];
  objectiveDescription: string;
  timeout: number;
  outputRouter: OutputRouter;
  recordStep: (type: string, content: unknown) => Promise<void>;
  signal?: AbortSignal;
}): Promise<void> {
  const { model, chatHistory, objectiveDescription, timeout, outputRouter, recordStep, signal } = params;

  const fallbackSystemPrompt = await buildSystemPrompt({
    agentId: "executor",
    systemInstructions: "You are a helpful conversational assistant. Respond naturally and concisely. Do NOT greet the user again if you already greeted them earlier in the conversation — continue naturally. IMPORTANT: Your system prompt includes a '# User Context' section — this is the user's persistent memory. When the user asks about their memory, preferences, or stored information, answer based on EVERYTHING in that User Context section.",
  });
  const fallbackMessages: ChatMessage[] = [
    { role: "system", content: fallbackSystemPrompt },
    ...chatHistory,
    { role: "user", content: objectiveDescription },
  ];

  const fallbackResponse = await callOpenRouter({
    model,
    messages: fallbackMessages,
    stream: false,
    signal,
    timeout,
    meta: { agentId: "fallback" },
  });

  const rawText = fallbackResponse.content || "I wasn't able to generate a response. Could you try rephrasing?";

  await recordStep("executor_summary", { text: rawText, agent: "fallback" });
  await outputRouter.emit(rawText, { agentId: "fallback" });
}

// ── Run Completion ─────────────────────────────────────────────

/**
 * Mark a run as completed and notify callbacks.
 */
export async function completeRun(
  runId: string,
  sequence: number,
  objectiveId: string,
  stepCount: number,
  callbacks: OrchestratorCallbacks,
): Promise<void> {
  await prisma.run.update({
    where: { id: runId },
    data: { status: "completed", endedAt: new Date() },
  });

  createLog("info", "coordinator", `Run #${sequence} completed`, {
    objectiveId,
    runId,
    totalSteps: stepCount,
  }, runId).catch(() => {});

  await callbacks.onComplete(runId);

  // ── Deep Learning trigger (async, non-blocking) ──
  triggerTrainingIfEnabled(runId, objectiveId).catch(() => {});
}

// ── Deep Learning Hook ────────────────────────────────────────

/**
 * Check if the completed run's skill has Deep Learning enabled.
 * If so, increment the run counter and trigger a training epoch
 * when the threshold is met. Runs asynchronously — never blocks
 * the main run completion flow.
 */
async function triggerTrainingIfEnabled(
  runId: string,
  objectiveId: string,
): Promise<void> {
  const objective = await prisma.objective.findUnique({
    where: { id: objectiveId },
    select: { skillId: true },
  });
  if (!objective?.skillId) return;

  const skill = await prisma.skill.findUnique({
    where: { id: objective.skillId },
    select: { deepLearning: true },
  });
  if (!skill) return;

  const { parseDeepLearningConfig } = await import("@/lib/training/types");
  const config = parseDeepLearningConfig(skill.deepLearning);
  if (!config.enabled || config.status === "optimized") return;

  // Increment run counter
  const newCount = config.runsSinceLastEpoch + 1;

  // Check if threshold is met
  if (newCount < config.trainEveryN) {
    const fresh = await prisma.skill.findUnique({ where: { id: objective.skillId }, select: { deepLearning: true } });
    const freshConfig = parseDeepLearningConfig(fresh?.deepLearning ?? "{}");
    freshConfig.runsSinceLastEpoch = newCount;
    await prisma.skill.update({
      where: { id: objective.skillId },
      data: { deepLearning: JSON.stringify(freshConfig) },
    });
    return;
  }

  // Reset counter and kick off training
  const fresh = await prisma.skill.findUnique({ where: { id: objective.skillId }, select: { deepLearning: true } });
  const freshConfig = parseDeepLearningConfig(fresh?.deepLearning ?? "{}");
  freshConfig.runsSinceLastEpoch = 0;
  await prisma.skill.update({
    where: { id: objective.skillId },
    data: { deepLearning: JSON.stringify(freshConfig) },
  });

  // Dynamic import to avoid circular deps (same pattern as scheduler.ts)
  const { runTrainingEpoch } = await import("@/lib/training/trainer");
  runTrainingEpoch(objective.skillId, runId).catch((err) => {
    createLog(
      "error",
      "system",
      `Training trigger failed for skill ${objective.skillId}: ${err instanceof Error ? err.message : String(err)}`,
    ).catch(() => {});
  });
}

// ── Error Handling ─────────────────────────────────────────────

/**
 * Handle run errors: cancellation, credit exhaustion, or general failures.
 */
export async function handleRunError(
  err: unknown,
  runId: string,
  sequence: number,
  objectiveId: string,
  signal: AbortSignal | undefined,
  recordStep: (type: string, content: unknown) => Promise<void>,
  callbacks: OrchestratorCallbacks,
): Promise<void> {
  const errorMsg = err instanceof Error ? err.message : String(err);

  if (signal?.aborted) {
    await recordStep("cancelled", { message: "Stopped by user" }).catch(() => {});
    await prisma.run.update({
      where: { id: runId },
      data: { status: "cancelled", endedAt: new Date() },
    });
    createLog("info", "coordinator", `Run #${sequence} cancelled by user`, {
      objectiveId,
      runId,
    }, runId).catch(() => {});
    await callbacks.onComplete(runId);
  } else if (err instanceof InsufficientCreditsError) {
    await recordStep("error", { error: errorMsg, creditsExhausted: true });
    await prisma.run.update({
      where: { id: runId },
      data: { status: "failed", endedAt: new Date() },
    });
    createLog("error", "coordinator", `Run #${sequence} failed: OpenRouter credits exhausted`, {
      objectiveId,
      runId,
    }, runId).catch(() => {});
    await callbacks.onError("Your OpenRouter credits have been exhausted. Please add credits at openrouter.ai to continue.", runId);
  } else {
    await recordStep("error", { error: errorMsg });
    await prisma.run.update({
      where: { id: runId },
      data: { status: "failed", endedAt: new Date() },
    });
    createLog("error", "coordinator", `Run #${sequence} failed: ${errorMsg}`, {
      objectiveId,
      runId,
      error: errorMsg,
    }, runId).catch(() => {});
    await callbacks.onError(errorMsg, runId);
  }
}
