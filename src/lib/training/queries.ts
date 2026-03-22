/**
 * Training pipeline — database queries for epochs, snapshots, rollback, and run history.
 */

import { prisma } from "@/lib/db/prisma";
import { skillDbExists, openSkillDb } from "@/lib/skills/skill-db";
import { parseDeepLearningConfig } from "./types";
import type { DeepLearningConfig } from "./types";
import type { RunSummary } from "./types";

// ── Epoch queries ────────────────────────────────────────────

export async function getTrainingEpochs(
  skillId: string,
  limit = 20,
  offset = 0,
) {
  const [epochs, total] = await Promise.all([
    prisma.trainingEpoch.findMany({
      where: { skillId },
      orderBy: { epoch: "desc" },
      take: limit,
      skip: offset,
      include: { snapshot: { select: { id: true, createdAt: true } } },
    }),
    prisma.trainingEpoch.count({ where: { skillId } }),
  ]);
  return { epochs, total };
}

export async function getLatestEpoch(skillId: string) {
  return prisma.trainingEpoch.findFirst({
    where: { skillId },
    orderBy: { epoch: "desc" },
  });
}

export async function getNextEpochNumber(skillId: string): Promise<number> {
  const latest = await getLatestEpoch(skillId);
  return (latest?.epoch ?? 0) + 1;
}

export async function getTrainingSnapshot(epochId: string) {
  return prisma.trainingSnapshot.findUnique({ where: { epochId } });
}

// ── Run history for trainer analysis ─────────────────────────

/**
 * Gather structured run history for a skill — the trainer uses this
 * to evaluate performance and generate improvement hypotheses.
 */
export async function getRunHistoryForSkill(
  skillId: string,
  limit = 5,
): Promise<RunSummary[]> {
  // Find objectives linked to this skill, then their runs
  const objectives = await prisma.objective.findMany({
    where: { skillId },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: limit * 2, // Get more objectives to ensure enough runs
  });

  if (objectives.length === 0) return [];

  const objectiveIds = objectives.map((o) => o.id);

  const runs = await prisma.run.findMany({
    where: { objectiveId: { in: objectiveIds } },
    orderBy: { startedAt: "desc" },
    take: limit,
    include: {
      steps: {
        select: { type: true, content: true, toolId: true },
        orderBy: { sequence: "asc" },
      },
    },
  });

  return runs.map((run) => {
    const errors: string[] = [];
    const toolsUsed = new Set<string>();
    let outputSummary = "";

    for (const step of run.steps) {
      if (step.type === "error") {
        try {
          const parsed = JSON.parse(step.content);
          errors.push(parsed.error || step.content);
        } catch {
          errors.push(step.content);
        }
      }

      if (step.type === "tool_call" && step.toolId) {
        try {
          const parsed = JSON.parse(step.content);
          toolsUsed.add(parsed.name || step.toolId);
        } catch {
          toolsUsed.add(step.toolId);
        }
      }

      if (step.type === "executor_summary") {
        try {
          const parsed = JSON.parse(step.content);
          outputSummary = (parsed.text || "").slice(0, 500);
        } catch {
          outputSummary = step.content.slice(0, 500);
        }
      }
    }

    return {
      runId: run.id,
      sequence: run.sequence,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      endedAt: run.endedAt?.toISOString() ?? null,
      stepCount: run.steps.length,
      errorCount: errors.length,
      toolsUsed: Array.from(toolsUsed),
      errors,
      outputSummary,
    };
  });
}

// ── Skill DB summary for trainer context ─────────────────────

export function getSkillDbSummary(skillId: string): string | null {
  if (!skillDbExists(skillId)) return null;

  try {
    const db = openSkillDb(skillId);
    try {
      // Get table list
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_metadata' AND name NOT LIKE 'sqlite_%'`,
        )
        .all() as Array<{ name: string }>;

      if (tables.length === 0) return "Database exists but has no tables.";

      const summary: string[] = [`Tables (${tables.length}):`];

      for (const table of tables) {
        const countRow = db
          .prepare(`SELECT COUNT(*) as cnt FROM "${table.name}"`)
          .get() as { cnt: number };

        const columns = db.prepare(`PRAGMA table_info("${table.name}")`).all() as Array<{
          name: string;
          type: string;
        }>;

        const colDesc = columns
          .map((c) => `${c.name} (${c.type || "TEXT"})`)
          .join(", ");

        summary.push(`- ${table.name}: ${countRow.cnt} rows [${colDesc}]`);

        // Sample last 3 rows for context
        if (countRow.cnt > 0) {
          const sampleRows = db
            .prepare(`SELECT * FROM "${table.name}" ORDER BY rowid DESC LIMIT 3`)
            .all();
          summary.push(
            `  Recent rows: ${JSON.stringify(sampleRows).slice(0, 500)}`,
          );
        }
      }

      return summary.join("\n");
    } finally {
      db.close();
    }
  } catch {
    return "Database exists but could not be read.";
  }
}

// ── Rollback ─────────────────────────────────────────────────

/**
 * Roll back a skill to the state captured in a training epoch's snapshot.
 */
export async function rollbackToSnapshot(epochId: string): Promise<void> {
  const snapshot = await prisma.trainingSnapshot.findUnique({
    where: { epochId },
    include: { epoch: { select: { skillId: true, epoch: true } } },
  });

  if (!snapshot) throw new Error(`Snapshot for epoch ${epochId} not found`);

  const skillId = snapshot.epoch.skillId;

  // Restore instructions
  await prisma.skill.update({
    where: { id: skillId },
    data: { instructions: snapshot.instructions },
  });

  // Restore guardrails: delete current, recreate from snapshot
  await prisma.guardrail.deleteMany({ where: { skillId } });
  const guardrails = JSON.parse(snapshot.guardrails) as Array<{
    rule: string;
    type: string;
    editableBy?: string;
  }>;
  if (guardrails.length > 0) {
    await prisma.guardrail.createMany({
      data: guardrails.map((g) => ({
        skillId,
        rule: g.rule,
        type: g.type,
        editableBy: g.editableBy ?? "both",
      })),
    });
  }

  // Restore tool links: delete current, recreate from snapshot
  const toolIds = JSON.parse(snapshot.toolIds) as string[];
  await prisma.skillTool.deleteMany({ where: { skillId } });
  if (toolIds.length > 0) {
    await prisma.skillTool.createMany({
      data: toolIds.map((toolId) => ({ skillId, toolId })),
    });
  }

  // Reset deep learning status to idle (preserving objective and other user settings)
  await safeUpdateDLConfig(skillId, { status: "idle", runsSinceLastEpoch: 0 });
}

// ── Reset training ───────────────────────────────────────────

/**
 * Reset training state — clears "optimized" status, resets counters.
 * Does NOT delete epoch history.
 */
export async function resetTraining(skillId: string): Promise<void> {
  await safeUpdateDLConfig(skillId, { status: "idle", runsSinceLastEpoch: 0 });
}

/**
 * Safe read-modify-write for DL config — only updates specified fields,
 * preserves everything else (especially the user's objective).
 */
async function safeUpdateDLConfig(
  skillId: string,
  updates: Partial<DeepLearningConfig>,
): Promise<void> {
  const skill = await prisma.skill.findUnique({
    where: { id: skillId },
    select: { deepLearning: true },
  });
  if (!skill) return;
  const current = parseDeepLearningConfig(skill.deepLearning);
  const merged = { ...current, ...updates };
  await prisma.skill.update({
    where: { id: skillId },
    data: { deepLearning: JSON.stringify(merged) },
  });
}

// ── Clear all epochs ─────────────────────────────────────────

/**
 * Delete all training epochs and snapshots for a skill, and reset status.
 */
export async function clearTrainingEpochs(skillId: string): Promise<void> {
  // Snapshots cascade-delete via the TrainingEpoch relation
  await prisma.trainingEpoch.deleteMany({ where: { skillId } });
  await resetTraining(skillId);
}

// ── Concurrent epoch guard ───────────────────────────────────

export async function hasRunningEpoch(skillId: string): Promise<boolean> {
  const running = await prisma.trainingEpoch.findFirst({
    where: { skillId, status: "running" },
  });
  return !!running;
}
