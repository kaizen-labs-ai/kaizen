import { prisma } from "@/lib/db/prisma";
import { CronExpressionParser } from "cron-parser";

/** Compute the next fire time for a cron expression. */
export function getNextRun(cron: string, lastRunAt: Date | null): string | null {
  try {
    // For */N minute crons, use interval-based timing (relative to last run)
    const minuteMatch = cron.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
    if (minuteMatch && lastRunAt) {
      const intervalMs = parseInt(minuteMatch[1]) * 60_000;
      return new Date(lastRunAt.getTime() + intervalMs).toISOString();
    }

    const now = new Date();
    const startFrom = lastRunAt && lastRunAt.getTime() > now.getTime() ? lastRunAt : now;
    const interval = CronExpressionParser.parse(cron, { currentDate: startFrom });
    return interval.next().toDate().toISOString();
  } catch {
    return null;
  }
}

/** Returns all schedules with their target name. */
export async function getAllSchedules() {
  return prisma.schedule.findMany({
    include: {
      skill: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Returns a single schedule with target details. */
export async function getSchedule(id: string) {
  return prisma.schedule.findUnique({
    where: { id },
    include: {
      skill: { select: { id: true, name: true } },
    },
  });
}
