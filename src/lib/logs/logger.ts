import { prisma } from "@/lib/db/prisma";
import { logEvents } from "@/lib/events/log-events";

export type LogLevel = "info" | "warn" | "error" | "debug";
export type LogSource = "orchestrator" | "coordinator" | "router" | "titler" | "tool" | "openrouter" | "system" | "developer" | "whatsapp";

export async function createLog(
  level: LogLevel,
  source: LogSource,
  message: string,
  meta?: Record<string, unknown>,
  runId?: string
) {
  const log = await prisma.log.create({
    data: {
      level,
      source,
      message,
      meta: meta ? JSON.stringify(meta) : "{}",
      runId,
    },
  });
  logEvents.emit({ type: "log-created" });
  return log;
}

export async function getLogs(options?: {
  level?: LogLevel;
  source?: LogSource;
  runId?: string;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = {};
  if (options?.level) where.level = options.level;
  if (options?.source) where.source = options.source;
  if (options?.runId) where.runId = options.runId;

  const logs = await prisma.log.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: options?.limit ?? 100,
    skip: options?.offset ?? 0,
  });

  // Batch-resolve runId → chatId via Run → Objective → Message
  const uniqueRunIds = [...new Set(logs.map((l) => l.runId).filter(Boolean))] as string[];
  const runToChatId: Record<string, string> = {};
  if (uniqueRunIds.length > 0) {
    const runs = await prisma.run.findMany({
      where: { id: { in: uniqueRunIds } },
      select: { id: true, objective: { select: { messages: { select: { chatId: true }, take: 1 } } } },
    });
    for (const run of runs) {
      const chatId = run.objective?.messages?.[0]?.chatId;
      if (chatId) runToChatId[run.id] = chatId;
    }
  }

  return logs.map((log) => ({
    ...log,
    chatId: log.runId ? (runToChatId[log.runId] ?? null) : null,
  }));
}

export async function getLogCount(options?: {
  level?: LogLevel;
  source?: LogSource;
}) {
  const where: Record<string, unknown> = {};
  if (options?.level) where.level = options.level;
  if (options?.source) where.source = options.source;

  return prisma.log.count({ where });
}

export async function clearLogs() {
  await prisma.log.deleteMany();
  logEvents.emit({ type: "logs-cleared" });
}
