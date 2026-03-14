import { prisma } from "@/lib/db/prisma";
import { CronExpressionParser } from "cron-parser";
import type { ToolExecutorFn, ToolExecutionResult } from "../types";
import { getNextRun } from "@/lib/schedules/queries";

// ── create-schedule ──────────────────────────────────────────

export const createScheduleExecutor: ToolExecutorFn = async (
  input
): Promise<ToolExecutionResult> => {
  const { name, cron, skillId, destination } = input;

  if (!name || !cron || !skillId) {
    return { success: false, output: null, error: "name, cron, and skillId are required" };
  }

  // Validate cron expression
  try {
    CronExpressionParser.parse(cron as string);
  } catch {
    return { success: false, output: null, error: `Invalid cron expression: "${cron}". Use standard 5-field cron (e.g. "0 10 * * *" for daily at 10:00 AM)` };
  }

  // Verify skill exists
  const skill = await prisma.skill.findUnique({ where: { id: skillId as string } });
  if (!skill) {
    return { success: false, output: null, error: `Skill "${skillId}" not found. Use list-skills to find the correct ID.` };
  }

  try {
    const schedule = await prisma.schedule.create({
      data: {
        name: name as string,
        cron: cron as string,
        targetType: "skill",
        skillId: skillId as string,
        destination: destination ? JSON.stringify(destination) : '{"type":"new_chat"}',
        enabled: true,
        lastRunAt: new Date(), // prevent immediate fire on next scheduler tick
      },
    });

    const nextRun = getNextRun(schedule.cron, null);

    return {
      success: true,
      output: {
        id: schedule.id,
        name: schedule.name,
        cron: schedule.cron,
        skillName: skill.name,
        nextRunAt: nextRun,
        message: `Schedule "${schedule.name}" created — runs skill "${skill.name}" on cron "${schedule.cron}"`,
      },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
};

// ── list-schedules ───────────────────────────────────────────

export const listSchedulesExecutor: ToolExecutorFn = async (): Promise<ToolExecutionResult> => {
  try {
    const schedules = await prisma.schedule.findMany({
      include: {
        skill: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      success: true,
      output: {
        schedules: schedules.map((s) => ({
          id: s.id,
          name: s.name,
          cron: s.cron,
          enabled: s.enabled,
          targetType: s.targetType,
          targetName: s.skill?.name ?? "unknown",
          targetId: s.skillId ?? null,
          nextRunAt: s.enabled ? getNextRun(s.cron, s.lastRunAt) : null,
        })),
      },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
};

// ── update-schedule ──────────────────────────────────────────

export const updateScheduleExecutor: ToolExecutorFn = async (
  input
): Promise<ToolExecutionResult> => {
  const { id, name, cron, enabled, destination } = input;

  if (!id) {
    return { success: false, output: null, error: "id is required. Use list-schedules to find the schedule ID." };
  }

  const existing = await prisma.schedule.findUnique({ where: { id: id as string } });
  if (!existing) {
    return { success: false, output: null, error: `Schedule "${id}" not found` };
  }

  // Validate cron if provided
  if (cron) {
    try {
      CronExpressionParser.parse(cron as string);
    } catch {
      return { success: false, output: null, error: `Invalid cron expression: "${cron}"` };
    }
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (cron !== undefined) data.cron = cron;
  if (enabled !== undefined) data.enabled = enabled;
  if (destination !== undefined) data.destination = JSON.stringify(destination);

  // Smart re-enable: reset lastRunAt so it doesn't immediately fire for missed ticks
  if (enabled === true && !existing.enabled) {
    data.lastRunAt = new Date();
  }

  try {
    const updated = await prisma.schedule.update({
      where: { id: id as string },
      data,
      include: {
        skill: { select: { name: true } },
      },
    });

    return {
      success: true,
      output: {
        id: updated.id,
        name: updated.name,
        cron: updated.cron,
        enabled: updated.enabled,
        message: `Schedule "${updated.name}" updated`,
      },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
};

// ── delete-schedule ──────────────────────────────────────────

export const deleteScheduleExecutor: ToolExecutorFn = async (
  input
): Promise<ToolExecutionResult> => {
  const { id } = input;

  if (!id) {
    return { success: false, output: null, error: "id is required. Use list-schedules to find the schedule ID." };
  }

  const existing = await prisma.schedule.findUnique({ where: { id: id as string } });
  if (!existing) {
    return { success: false, output: null, error: `Schedule "${id}" not found` };
  }

  try {
    await prisma.schedule.delete({ where: { id: id as string } });
    return {
      success: true,
      output: { message: `Schedule "${existing.name}" deleted` },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
};
