/**
 * Deep Learning training pipeline — the core engine.
 *
 * After a skill run completes, this module:
 * 1. Gathers context (run history, skill config, DB data, epoch history)
 * 2. Calls the trainer agent to analyze performance and propose improvements
 * 3. Snapshots the current state, applies the mutation, records the epoch
 * 4. Checks for convergence
 */

import { prisma } from "@/lib/db/prisma";
import { callOpenRouter } from "@/lib/openrouter/client";
import { parseJsonResponse, jsonFormat } from "@/lib/agent/schemas";
import { getSkillWithDetails } from "@/lib/skills/registry";
import { createLog } from "@/lib/logs/logger";
import { trainingEvents } from "@/lib/events/training-events";
import { ensureAgentConfigs } from "@/lib/agents/defaults";
import { parseDeepLearningConfig } from "./types";
import type { TrainerResponse, DeepLearningConfig } from "./types";
import {
  getNextEpochNumber,
  getRunHistoryForSkill,
  getSkillDbSummary,
  getTrainingEpochs,
  hasRunningEpoch,
} from "./queries";

// ── JSON schema for structured response ──────────────────────

const TRAINER_RESPONSE_SCHEMA = {
  name: "trainer_response",
  strict: false,
  schema: {
    type: "object",
    properties: {
      hypothesis: { type: "string" },
      action: {
        type: "string",
        enum: [
          "modify_instructions",
          "add_guardrail",
          "remove_guardrail",
          "modify_guardrail",
          "add_tool",
          "remove_tool",
          "create_plugin",
          "edit_plugin",
          "modify_db_schema",
          "no_change",
        ],
      },
      mutation: { type: "object" },
      fitness: {
        type: "object",
        properties: {
          completion_rate: { type: "number" },
          error_rate: { type: "number" },
          efficiency: { type: "number" },
          quality: { type: "number" },
          data_quality: { type: "number" },
          composite: { type: "number" },
        },
        required: [
          "completion_rate",
          "error_rate",
          "efficiency",
          "quality",
          "data_quality",
          "composite",
        ],
      },
      converged: { type: "boolean" },
      convergence_reason: { type: ["string", "null"] },
    },
    required: [
      "hypothesis",
      "action",
      "mutation",
      "fitness",
      "converged",
      "convergence_reason",
    ],
  },
};

// ── Main entry point ────────────────────────────────────────

export async function runTrainingEpoch(
  skillId: string,
  triggerRunId: string,
): Promise<void> {
  const startTime = performance.now();

  // ── 1. Load skill & validate guards ─────────────────────
  const skill = await getSkillWithDetails(skillId);
  if (!skill) {
    createLog("warn", "system", `Training skipped: skill ${skillId} not found`).catch(() => {});
    return;
  }

  const config = parseDeepLearningConfig(skill.deepLearning as string);
  if (!config.enabled || config.status === "optimized") return;

  // Check max epochs
  const { total: epochCount } = await getTrainingEpochs(skillId, 1, 0);
  if (epochCount >= config.maxEpochs) {
    await updateDLConfig(skillId, { status: "optimized" });
    createLog("info", "system", `Skill "${skill.name}" reached max training epochs (${config.maxEpochs}), marking as optimized`).catch(() => {});
    return;
  }

  // Concurrent guard
  if (await hasRunningEpoch(skillId)) {
    createLog("debug", "system", `Training skipped: epoch already running for skill "${skill.name}"`).catch(() => {});
    return;
  }

  // ── 2. Update status to "training" ──────────────────────
  await updateDLConfig(skillId, { status: "training" });
  trainingEvents.emit({ type: "status-changed", skillId, status: "training" });

  const epochNumber = await getNextEpochNumber(skillId);

  // ── 3. Create epoch record ──────────────────────────────
  const epoch = await prisma.trainingEpoch.create({
    data: {
      skillId,
      epoch: epochNumber,
      triggerRunId,
      status: "running",
    },
  });
  trainingEvents.emit({ type: "epoch-started", skillId, epoch: epochNumber });

  try {
    // ── 4. Create snapshot of current state ──────────────
    await prisma.trainingSnapshot.create({
      data: {
        epochId: epoch.id,
        instructions: skill.instructions,
        guardrails: JSON.stringify(
          (skill.guardrails || []).map((g: { id: string; rule: string; type: string; editableBy: string }) => ({
            id: g.id,
            rule: g.rule,
            type: g.type,
            editableBy: g.editableBy,
          })),
        ),
        toolIds: JSON.stringify(
          (skill.tools || []).map((t: { toolId: string }) => t.toolId),
        ),
        pluginData: JSON.stringify(
          (skill.tools || [])
            .filter((t: { tool: { type: string } }) => t.tool.type === "plugin")
            .map((t: { toolId: string; tool: { name: string } }) => ({
              toolId: t.toolId,
              name: t.tool.name,
            })),
        ),
      },
    });

    // ── 5. Gather context in parallel ─────────────────────
    const [runHistory, skillDbSummary, previousEpochs] = await Promise.all([
      getRunHistoryForSkill(skillId, 5),
      Promise.resolve(getSkillDbSummary(skillId)),
      getTrainingEpochs(skillId, 10, 0),
    ]);

    if (runHistory.length < 1) {
      // Not enough data to train — complete with no change
      await prisma.trainingEpoch.update({
        where: { id: epoch.id },
        data: {
          status: "completed",
          hypothesis: "Insufficient run data for analysis — need at least 1 completed run.",
          mutation: JSON.stringify({ reason: "insufficient data" }),
          fitness: null,
          endedAt: new Date(),
        },
      });
      await updateDLConfig(skillId, { status: "idle" });
      return;
    }

    // ── 6. Build trainer context message ───────────────────
    const trainerContext = buildTrainerContext(skill, runHistory, skillDbSummary, previousEpochs.epochs, config.objective || undefined);

    // ── 7. Load trainer agent config & call LLM ───────────
    await ensureAgentConfigs();
    const trainerAgent = await prisma.agentConfig.findUnique({ where: { id: "trainer" } });
    if (!trainerAgent) {
      throw new Error("Trainer agent config not found");
    }

    const response = await callOpenRouter({
      model: trainerAgent.model,
      messages: [
        { role: "system", content: trainerAgent.systemPrompt },
        { role: "user", content: trainerContext },
      ],
      stream: false,
      thinking: trainerAgent.thinking,
      response_format: jsonFormat(TRAINER_RESPONSE_SCHEMA),
      timeout: (trainerAgent.timeout ?? 300) * 1000,
      meta: { agentId: "trainer", runId: triggerRunId },
    });

    const cost = response.cost ?? 0;

    // ── 8. Parse trainer response ─────────────────────────
    const trainerResponse = parseJsonResponse<TrainerResponse>(response.content);
    if (!trainerResponse) {
      throw new Error(`Failed to parse trainer response: ${response.content.slice(0, 200)}`);
    }

    // ── 9. Auto-rollback check ──────────────────────────
    // If fitness has dropped significantly from the best recent epoch,
    // rollback to that epoch's snapshot instead of applying the new mutation.
    const completedEpochs = previousEpochs.epochs.filter(
      (e) => e.status === "completed" && e.fitness != null
    );
    const previousFitness = completedEpochs.length > 0 ? completedEpochs[0].fitness : null;
    const bestRecentEpoch = completedEpochs.reduce<{ id: string; fitness: number | null; epoch: number } | null>(
      (best, e) => (!best || (e.fitness ?? 0) > (best.fitness ?? 0)) ? e : best,
      null,
    );

    const currentFitness = trainerResponse.fitness.composite;
    const REGRESSION_THRESHOLD = 0.10; // 10% drop from best triggers rollback

    let rolledBack = false;
    const fitnessRegressed = bestRecentEpoch &&
      bestRecentEpoch.fitness != null &&
      currentFitness < bestRecentEpoch.fitness - REGRESSION_THRESHOLD;

    if (fitnessRegressed) {
      // When the trainer proposes an actual fix (not no_change), skip auto-rollback
      // and let the fix be applied. The fix's effectiveness is evaluated on the next epoch.
      // This prevents the "rollback trap" where a broken plugin causes poor fitness →
      // auto-rollback discards the fix → plugin stays broken → poor fitness → rollback forever.
      const trainerProposedFix = trainerResponse.action !== "no_change";

      if (trainerProposedFix) {
        createLog("info", "system",
          `Training: fitness ${(currentFitness * 100).toFixed(1)}% regressed from best epoch #${bestRecentEpoch!.epoch} (${(bestRecentEpoch!.fitness! * 100).toFixed(1)}%), but trainer proposed a fix (${trainerResponse.action}). Applying fix instead of rolling back.`,
          { skillId, epochId: epoch.id, action: trainerResponse.action },
        ).catch(() => {});
      } else {
        // Trainer sees poor fitness but has nothing to fix — rollback to best state
        try {
          const { rollbackToSnapshot } = await import("./queries");
          await rollbackToSnapshot(bestRecentEpoch!.id);
          rolledBack = true;

          createLog("warn", "system",
            `Training auto-rollback: fitness ${(currentFitness * 100).toFixed(1)}% is ${((bestRecentEpoch!.fitness! - currentFitness) * 100).toFixed(1)}% below best epoch #${bestRecentEpoch!.epoch} (${(bestRecentEpoch!.fitness! * 100).toFixed(1)}%). Rolled back to epoch #${bestRecentEpoch!.epoch} snapshot.`,
            { skillId, epochId: epoch.id, rolledBackTo: bestRecentEpoch!.id },
          ).catch(() => {});
        } catch (rollbackErr) {
          createLog("error", "system",
            `Training auto-rollback failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
            { skillId, epochId: epoch.id },
          ).catch(() => {});
        }
      }
    }

    // ── 10. Apply mutation (only if not rolled back) ─────
    if (!rolledBack && trainerResponse.action !== "no_change") {
      await applyMutation(skillId, skill, trainerResponse, triggerRunId);
    }

    // ── 11. Update epoch record ───────────────────────────
    const durationMs = Math.round(performance.now() - startTime);
    await prisma.trainingEpoch.update({
      where: { id: epoch.id },
      data: {
        status: rolledBack ? "rolled_back" : "completed",
        hypothesis: rolledBack
          ? `AUTO-ROLLBACK: Fitness ${(currentFitness * 100).toFixed(1)}% regressed below best epoch #${bestRecentEpoch!.epoch} (${(bestRecentEpoch!.fitness! * 100).toFixed(1)}%). Restored snapshot. Original hypothesis: ${trainerResponse.hypothesis}`
          : trainerResponse.hypothesis,
        mutation: JSON.stringify({
          action: rolledBack ? "auto_rollback" : trainerResponse.action,
          ...(rolledBack ? { rolledBackToEpoch: bestRecentEpoch!.epoch } : trainerResponse.mutation),
        }),
        fitness: trainerResponse.fitness.composite,
        fitnessBreakdown: JSON.stringify(trainerResponse.fitness),
        cost,
        endedAt: new Date(),
      },
    });

    // ── 11. Check convergence ─────────────────────────────
    if (trainerResponse.converged) {
      config.status = "optimized";
      createLog("info", "system", `Skill "${skill.name}" training converged: ${trainerResponse.convergence_reason}`, {
        skillId,
        epochId: epoch.id,
        fitness: trainerResponse.fitness.composite,
      }).catch(() => {});
    }
    await updateDLConfig(skillId, {
      status: trainerResponse.converged ? "optimized" : "idle",
      runsSinceLastEpoch: 0,
    });

    createLog("info", "system", `Training epoch ${epochNumber} completed for skill "${skill.name}"`, {
      skillId,
      epochId: epoch.id,
      action: trainerResponse.action,
      fitness: trainerResponse.fitness.composite,
      converged: trainerResponse.converged,
      durationMs,
      cost,
    }).catch(() => {});

    const finalStatus = trainerResponse.converged ? "optimized" : "idle";
    trainingEvents.emit({ type: "epoch-completed", skillId, epoch: epochNumber, fitness: trainerResponse.fitness.composite });
    trainingEvents.emit({ type: "status-changed", skillId, status: finalStatus });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Mark epoch as failed
    await prisma.trainingEpoch.update({
      where: { id: epoch.id },
      data: {
        status: "failed",
        hypothesis: `Training failed: ${errorMsg}`,
        endedAt: new Date(),
      },
    }).catch(() => {});

    // Reset status to idle so next run can retry
    await updateDLConfig(skillId, { status: "idle" }).catch(() => {});

    createLog("error", "system", `Training epoch ${epochNumber} failed for skill "${skill.name}": ${errorMsg}`, {
      skillId,
      epochId: epoch.id,
    }).catch(() => {});

    trainingEvents.emit({ type: "epoch-failed", skillId, epoch: epochNumber });
    trainingEvents.emit({ type: "status-changed", skillId, status: "idle" });
  }
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Update DL config with a read-modify-write pattern.
 * Re-reads the current config from DB first to avoid overwriting
 * user changes (e.g., objective) made during the training epoch.
 */
async function updateDLConfig(
  skillId: string,
  updates: Partial<DeepLearningConfig>,
): Promise<void> {
  const skill = await prisma.skill.findUnique({
    where: { id: skillId },
    select: { deepLearning: true },
  });
  const current = parseDeepLearningConfig(skill?.deepLearning ?? "{}");
  const merged = { ...current, ...updates };
  await prisma.skill.update({
    where: { id: skillId },
    data: { deepLearning: JSON.stringify(merged) },
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function buildTrainerContext(
  skill: any,
  runHistory: any[],
  skillDbSummary: string | null,
  previousEpochs: any[],
  trainingObjective?: string,
): string {
  const sections: string[] = [];

  // Training objective — the user's primary goal for optimization
  if (trainingObjective) {
    sections.push(`## TRAINING OBJECTIVE (from the user — this is your PRIMARY optimization target)`);
    sections.push(trainingObjective);
    sections.push(`\nAll your analysis, fitness scoring, and proposed changes MUST be evaluated against this objective. A change that improves generic metrics but hurts this objective is a BAD change.\n`);
  }

  // Skill identity
  sections.push(`## Skill: ${skill.name}`);
  sections.push(`**Description:** ${skill.description}`);
  sections.push(`**Instructions:**\n${skill.instructions}`);

  // Guardrails
  if (skill.guardrails?.length > 0) {
    sections.push(
      `\n## Guardrails (${skill.guardrails.length}):\n` +
        skill.guardrails
          .map((g: any) => `- [${g.type}] ${g.rule} (id: ${g.id})`)
          .join("\n"),
    );
  } else {
    sections.push("\n## Guardrails: None");
  }

  // Linked tools
  if (skill.tools?.length > 0) {
    sections.push(
      `\n## Linked Tools (${skill.tools.length}):\n` +
        skill.tools.map((t: any) => `- ${t.tool.name} (${t.tool.type})`).join("\n"),
    );
  }

  // Skill database
  if (skillDbSummary) {
    sections.push(`\n## Skill Database:\n${skillDbSummary}`);
  } else {
    sections.push("\n## Skill Database: None");
  }

  // Run history
  sections.push(`\n## Recent Run History (${runHistory.length} runs):`);
  for (const run of runHistory) {
    sections.push(
      `\n### Run ${run.sequence} (${run.status})` +
        `\n- Started: ${run.startedAt}` +
        `\n- Ended: ${run.endedAt ?? "N/A"}` +
        `\n- Steps: ${run.stepCount}` +
        `\n- Errors: ${run.errorCount}` +
        `\n- Tools used: ${run.toolsUsed.join(", ") || "none"}` +
        (run.errors.length > 0
          ? `\n- Error details:\n${run.errors.map((e: string) => `  - ${e.slice(0, 300)}`).join("\n")}`
          : "") +
        (run.outputSummary
          ? `\n- Output: ${run.outputSummary}`
          : ""),
    );
  }

  // Previous training epochs
  if (previousEpochs.length > 0) {
    sections.push(
      `\n## Previous Training Epochs (${previousEpochs.length}):`,
    );
    for (const ep of previousEpochs) {
      const fitness = ep.fitness != null ? ep.fitness.toFixed(3) : "N/A";
      sections.push(
        `- Epoch ${ep.epoch}: ${ep.status} | Fitness: ${fitness} | ${ep.hypothesis.slice(0, 200)}`,
      );
    }
  }

  sections.push("\n## Task");
  sections.push(
    "Analyze the skill's recent performance and propose ONE improvement. " +
      "Return your analysis as a JSON object following the format specified in your system prompt.",
  );

  return sections.join("\n");
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Guard against destructive instruction updates.
 * Rejects updates that are less than 50% the length of current instructions —
 * this catches cases where the trainer LLM returns a partial fragment instead
 * of the full instructions with targeted edits.
 * Returns true if the update is safe to apply, false if rejected.
 */
async function safeInstructionsUpdate(
  skillId: string,
  newInstructions: string,
  context: string,
): Promise<boolean> {
  const currentSkill = await prisma.skill.findUnique({
    where: { id: skillId },
    select: { instructions: true },
  });
  const currentLen = currentSkill?.instructions?.length ?? 0;
  const newLen = newInstructions.length;

  // Reject if new instructions are less than 50% of current length (likely a partial fragment)
  if (currentLen > 0 && newLen < currentLen * 0.5) {
    createLog(
      "warn", "system",
      `Training ${context}: BLOCKED destructive instructions update (${newLen} chars would replace ${currentLen} chars — ${Math.round(newLen / currentLen * 100)}% of original). The trainer likely returned a partial fragment instead of the full instructions.`,
      { skillId, currentLen, newLen },
    ).catch(() => {});
    return false;
  }

  await prisma.skill.update({
    where: { id: skillId },
    data: { instructions: newInstructions },
  });
  return true;
}

/**
 * Sanitize an inputSchema from the trainer LLM.
 * Fixes a common corruption pattern where the real schema is buried in a
 * "payload" sub-field while top-level properties are all declared as "string".
 * Also strips non-standard fields that confuse the tool execution layer.
 */
function sanitizeInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  // If there's a "payload" field with a real schema inside, extract and use it
  if (schema.payload && typeof schema.payload === "string") {
    try {
      const payload = JSON.parse(schema.payload);
      if (payload.type === "object" && payload.properties) {
        createLog("warn", "system", `Training sanitizeInputSchema: extracted real schema from "payload" sub-field`).catch(() => {});
        return payload;
      }
    } catch { /* not valid JSON, ignore */ }
  }
  if (schema.payload && typeof schema.payload === "object") {
    const payload = schema.payload as Record<string, unknown>;
    if (payload.type === "object" && payload.properties) {
      createLog("warn", "system", `Training sanitizeInputSchema: extracted real schema from "payload" sub-field`).catch(() => {});
      return payload;
    }
  }

  // Strip the payload field if it exists but wasn't a valid schema
  const cleaned = { ...schema };
  delete cleaned.payload;
  return cleaned;
}

async function applyMutation(
  skillId: string,
  skill: { tools?: Array<{ toolId: string }> },
  response: TrainerResponse,
  triggerRunId?: string,
): Promise<void> {
  const mutation = response.mutation;

  switch (response.action) {
    case "modify_instructions": {
      const newInstructions = mutation.instructions as string;
      if (newInstructions) {
        await safeInstructionsUpdate(skillId, newInstructions, "modify_instructions");
      }
      break;
    }

    case "add_guardrail": {
      const rule = mutation.rule as string;
      const type = (mutation.type as string) || "must";
      if (rule) {
        await prisma.guardrail.create({
          data: { skillId, rule, type },
        });
      }
      break;
    }

    case "remove_guardrail": {
      const guardrailId = mutation.guardrailId as string;
      if (guardrailId) {
        await prisma.guardrail.delete({ where: { id: guardrailId } }).catch(() => {
          // Guard might not exist
        });
      }
      break;
    }

    case "modify_guardrail": {
      const gId = mutation.guardrailId as string;
      const newRule = mutation.rule as string;
      const newType = mutation.type as string;
      if (gId) {
        await prisma.guardrail.update({
          where: { id: gId },
          data: {
            ...(newRule ? { rule: newRule } : {}),
            ...(newType ? { type: newType } : {}),
          },
        }).catch(() => {});
      }
      break;
    }

    case "add_tool": {
      const toolName = mutation.toolName as string;
      if (toolName) {
        const tool = await prisma.tool.findUnique({ where: { name: toolName } });
        if (tool) {
          await prisma.skillTool.create({
            data: { skillId, toolId: tool.id },
          }).catch(() => {
            // Already linked
          });
        }
      }
      break;
    }

    case "remove_tool": {
      const removeToolName = mutation.toolName as string;
      if (removeToolName) {
        const tool = await prisma.tool.findUnique({ where: { name: removeToolName } });
        if (tool) {
          await prisma.skillTool.deleteMany({
            where: { skillId, toolId: tool.id },
          });
        }
      }
      break;
    }

    case "modify_db_schema": {
      const sqlStatements = mutation.sql as string[];
      const schemaInstructionsUpdate = mutation.instructions_update as string;

      if (!sqlStatements || sqlStatements.length === 0) break;

      try {
        const { openSkillDb, skillDbExists } = await import("@/lib/skills/skill-db");

        // Create the DB if it doesn't exist yet
        const db = openSkillDb(skillId);
        try {
          for (const sql of sqlStatements) {
            // Only allow DDL statements (CREATE, ALTER, DROP) — no data manipulation
            const trimmed = sql.trim().toUpperCase();
            if (!trimmed.startsWith("CREATE") && !trimmed.startsWith("ALTER") && !trimmed.startsWith("DROP")) {
              createLog("warn", "system", `Training modify_db_schema: blocked non-DDL statement: ${sql.slice(0, 100)}`).catch(() => {});
              continue;
            }
            db.exec(sql);
          }
        } finally {
          db.close();
        }

        // Update instructions to tell the executor to use the new schema
        if (schemaInstructionsUpdate) {
          await safeInstructionsUpdate(skillId, schemaInstructionsUpdate, "modify_db_schema");
        }

        createLog("info", "system", `Training modified DB schema for skill ${skillId}: ${sqlStatements.length} statement(s)`).catch(() => {});
      } catch (err) {
        createLog("error", "system", `Training failed to modify DB schema for skill ${skillId}: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
      }
      break;
    }

    case "create_plugin": {
      const pluginName = mutation.name as string;
      const pluginDesc = mutation.description as string;
      const pluginLang = (mutation.language as string) || "python";
      const specification = mutation.specification as string;
      let pluginInputSchema = mutation.inputSchema as Record<string, unknown> | undefined;
      const pluginDeps = (mutation.dependencies as string[]) || [];

      if (!pluginName || !specification) break;

      // Fix corrupted inputSchema: the trainer LLM sometimes puts the real schema
      // inside a "payload" sub-field while declaring all properties as type:"string"
      // at the top level. Extract the real schema from payload if it exists.
      if (pluginInputSchema) {
        pluginInputSchema = sanitizeInputSchema(pluginInputSchema);
      }

      try {
        // Build a skeleton script for the developer agent to enhance
        const skeleton = buildPluginSkeleton(pluginLang, pluginName, specification);

        // Run the code pipeline (developer → test → review)
        const { runCodePipeline } = await import("@/lib/agent/code-pipeline");
        const pipelineResult = await runCodePipeline(
          "create-plugin",
          {
            name: pluginName,
            description: pluginDesc || specification.slice(0, 100),
            language: pluginLang,
            script: skeleton,
            inputSchema: pluginInputSchema || { type: "object", properties: {} },
            dependencies: pluginDeps,
          },
          `Training pipeline: Create a plugin called "${pluginName}" that ${specification}`,
          triggerRunId || "training",
          async () => {}, // recordStep — silent for training
        );

        // Only register the plugin if the pipeline succeeded (review passed).
        // Without this check, broken plugins get registered and fail on every run.
        if (!pipelineResult.reviewMeta) {
          createLog("warn", "system", `Training create_plugin "${pluginName}": pipeline FAILED (no review result) — plugin NOT registered`).catch(() => {});
          break;
        }
        if (!pipelineResult.reviewMeta.passed) {
          createLog("warn", "system", `Training create_plugin "${pluginName}": pipeline review FAILED — plugin NOT registered. Issues: ${pipelineResult.reviewMeta.lastIssues?.join("; ")}`).catch(() => {});
          break;
        }

        // Register the plugin via the executor
        const { executeTool } = await import("@/lib/tools/executor");
        const result = await executeTool(
          "create-plugin",
          pipelineResult.toolArgs,
          { objectiveId: "training", runId: triggerRunId || "training", agentId: "trainer" },
        );

        // Link the new plugin to the skill
        if (result.success) {
          const output = result.output as { toolId?: string };
          if (output?.toolId) {
            await prisma.skillTool.create({
              data: { skillId, toolId: output.toolId },
            }).catch(() => {});
          }
        }

        // Update instructions to reference the new plugin (if provided)
        const createInstructionsUpdate = mutation.instructions_update as string;
        if (createInstructionsUpdate) {
          await safeInstructionsUpdate(skillId, createInstructionsUpdate, "create_plugin");
        }

        createLog("info", "system", `Training created plugin "${pluginName}" for skill ${skillId}`).catch(() => {});
      } catch (err) {
        createLog("error", "system", `Training failed to create plugin "${pluginName}": ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
      }
      break;
    }

    case "edit_plugin": {
      const editPluginName = mutation.name as string;
      const patchDescription = mutation.patch as string;

      if (!editPluginName || !patchDescription) break;

      try {
        // Load the existing plugin script
        const existingPlugin = await prisma.tool.findUnique({ where: { name: editPluginName } });
        if (!existingPlugin) break;

        const pluginConfig = JSON.parse(existingPlugin.config || "{}");
        const scriptPath = pluginConfig.scriptPath as string;
        if (!scriptPath) break;

        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const fullPath = path.join(process.cwd(), scriptPath);
        const existingScript = await fs.readFile(fullPath, "utf-8");

        // Run the code pipeline in patch mode
        const { runCodePipeline } = await import("@/lib/agent/code-pipeline");
        const pipelineResult = await runCodePipeline(
          "edit-plugin",
          {
            name: editPluginName,
            script: existingScript,
            description: patchDescription,
          },
          `Training pipeline: Modify plugin "${editPluginName}" — ${patchDescription}`,
          triggerRunId || "training",
          async () => {},
        );

        // Only apply the edit if the pipeline succeeded (review passed).
        if (!pipelineResult.reviewMeta) {
          createLog("warn", "system", `Training edit_plugin "${editPluginName}": pipeline FAILED (no review result) — edit NOT applied`).catch(() => {});
          break;
        }
        if (!pipelineResult.reviewMeta.passed) {
          createLog("warn", "system", `Training edit_plugin "${editPluginName}": pipeline review FAILED — edit NOT applied. Issues: ${pipelineResult.reviewMeta.lastIssues?.join("; ")}`).catch(() => {});
          break;
        }

        // Apply the edit via the executor
        const { executeTool } = await import("@/lib/tools/executor");
        await executeTool("edit-plugin", pipelineResult.toolArgs);

        // Update instructions to reflect plugin changes (if provided)
        const editInstructionsUpdate = mutation.instructions_update as string;
        if (editInstructionsUpdate) {
          await safeInstructionsUpdate(skillId, editInstructionsUpdate, "edit_plugin");
        }

        createLog("info", "system", `Training patched plugin "${editPluginName}" for skill ${skillId}`).catch(() => {});
      } catch (err) {
        createLog("error", "system", `Training failed to patch plugin "${editPluginName}": ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
      }
      break;
    }

    case "no_change":
    default:
      // No mutation needed
      break;
  }
}

/** Generate a minimal skeleton script for the developer agent to enhance. */
function buildPluginSkeleton(language: string, name: string, specification: string): string {
  const comment = language === "python" ? "#" : "//";
  const header = `${comment} Plugin: ${name}\n${comment} Specification: ${specification}\n`;

  switch (language) {
    case "python":
      return `${header}
import json
import sys

data = json.loads(sys.stdin.read())

# TODO: Implement — ${specification}
result = {}

print(json.dumps({"status": "success", "summary": "Done", "files": [], **result}))
`;
    case "node":
    case "typescript":
      return `${header}
const data = JSON.parse(require("fs").readFileSync("/dev/stdin", "utf-8"));

// TODO: Implement — ${specification}
const result = {};

console.log(JSON.stringify({ status: "success", summary: "Done", files: [], ...result }));
`;
    default:
      return `${header}\n# TODO: Implement — ${specification}\n`;
  }
}
