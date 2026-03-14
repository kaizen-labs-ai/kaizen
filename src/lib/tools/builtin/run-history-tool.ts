/**
 * Run History tool — lets the executor inspect its own past actions
 * from previous runs in the same chat thread.
 */

import { prisma } from "@/lib/db/prisma";
import type { ContextualToolExecutorFn, ToolExecutionResult } from "../types";

/** Max chars for a single tool arg value in the detail view */
const ARG_TRUNCATE = 200;
/** Max chars for a tool result error message */
const ERROR_TRUNCATE = 300;
/** Max total chars for a detail report before truncation */
const DETAIL_MAX_CHARS = 4000;

// ── List mode ────────────────────────────────────────────────

async function listRuns(chatId: string, currentRunId: string): Promise<ToolExecutionResult> {
  // Find all runs in this chat via messages linked to objectives
  const messages = await prisma.message.findMany({
    where: { chatId, runId: { not: null } },
    select: { runId: true },
    orderBy: { createdAt: "asc" },
  });

  const runIds = [...new Set(messages.map((m) => m.runId!))].filter(
    (id) => id !== currentRunId,
  );

  if (runIds.length === 0) {
    return { success: true, output: { runs: [], message: "No previous runs in this chat." } };
  }

  const runs = await prisma.run.findMany({
    where: { id: { in: runIds } },
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      objective: { select: { title: true, skillId: true } },
    },
    orderBy: { startedAt: "desc" },
  });

  // Get executor_summary for each run (one query)
  const summarySteps = await prisma.step.findMany({
    where: {
      runId: { in: runIds },
      type: "executor_summary",
    },
    select: { runId: true, content: true },
  });
  const summaryMap = new Map<string, string>();
  for (const s of summarySteps) {
    try {
      const parsed = JSON.parse(s.content);
      if (parsed.text && (!parsed.agent || parsed.agent !== "planner")) {
        summaryMap.set(s.runId, parsed.text.slice(0, 200));
      }
    } catch { /* skip */ }
  }

  // Get tool call counts per run
  const toolCountSteps = await prisma.step.groupBy({
    by: ["runId"],
    where: { runId: { in: runIds }, type: "tool_call" },
    _count: true,
  });
  const toolCountMap = new Map(toolCountSteps.map((s) => [s.runId, s._count]));

  const output = runs.map((r, i) => ({
    index: runs.length - i,
    runId: r.id,
    status: r.status,
    startedAt: r.startedAt?.toISOString() ?? null,
    skill: r.objective?.title ?? null,
    toolCalls: toolCountMap.get(r.id) ?? 0,
    summary: summaryMap.get(r.id) ?? null,
  }));

  return { success: true, output: { runs: output } };
}

// ── Detail mode ──────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function summarizeArgs(args: unknown): string {
  if (!args) return "";
  const obj = typeof args === "string" ? (() => { try { return JSON.parse(args); } catch { return args; } })() : args;
  if (typeof obj === "string") return truncate(obj, ARG_TRUNCATE);
  if (typeof obj !== "object" || obj === null) return String(obj);

  const entries = Object.entries(obj as Record<string, unknown>);
  const parts: string[] = [];
  for (const [key, val] of entries) {
    const valStr = typeof val === "string" ? val : JSON.stringify(val);
    parts.push(`${key}: ${truncate(valStr ?? "", ARG_TRUNCATE)}`);
  }
  return parts.join(", ");
}

async function detailRun(runId: string): Promise<ToolExecutionResult> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      objective: { select: { title: true } },
    },
  });
  if (!run) return { success: false, output: null, error: "Run not found" };

  const steps = await prisma.step.findMany({
    where: { runId },
    orderBy: { sequence: "asc" },
    select: { type: true, content: true },
  });

  const lines: string[] = [];
  lines.push(`Run: ${run.objective?.title ?? runId} (${run.status})`);
  lines.push("");

  for (const step of steps) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(step.content); } catch { continue; }

    switch (step.type) {
      case "tool_call": {
        const name = parsed.name as string;
        const args = summarizeArgs(parsed.arguments);
        lines.push(`→ ${name}${args ? ` (${args})` : ""}`);
        break;
      }
      case "tool_result": {
        const result = parsed.result as Record<string, unknown> | undefined;
        if (result) {
          const success = result.success as boolean;
          const error = result.error as string | undefined;
          const output = result.output;
          let detail = "";
          if (error) {
            detail = ` — ${truncate(error, ERROR_TRUNCATE)}`;
          } else if (output && typeof output === "object") {
            const out = output as Record<string, unknown>;
            // Extract brief useful info from common output shapes
            if (out.message) detail = ` — ${truncate(String(out.message), 150)}`;
            else if (out.summary) detail = ` — ${truncate(String(out.summary), 150)}`;
            else if (out.rowCount !== undefined) detail = ` — ${out.rowCount} rows`;
          }
          lines.push(`  ${success ? "✓" : "✗ FAILED"}${detail}`);
        }
        break;
      }
      case "executor_summary": {
        const agent = parsed.agent as string | undefined;
        if (agent !== "planner" && parsed.text) {
          lines.push("");
          lines.push(`Summary: ${parsed.text}`);
        }
        break;
      }
    }
  }

  const report = lines.join("\n");
  const truncatedReport = report.length > DETAIL_MAX_CHARS
    ? report.slice(0, DETAIL_MAX_CHARS) + "\n[truncated]"
    : report;

  return {
    success: true,
    output: {
      report: truncatedReport,
      _hint: "If you identified gaps, mistakes, or inefficiencies in this run, fix them NOW: call list-skills to find the skill ID, then edit-skill to update the instructions. Don't describe the problem to the user — fix it first, then tell them what you changed.",
    },
  };
}

// ── Executor factory ─────────────────────────────────────────

export const readRunHistoryExecutorFactory: ContextualToolExecutorFn = (ctx) => {
  return async (input): Promise<ToolExecutionResult> => {
    const mode = (input.mode as string) || "detail";

    // Resolve chatId from current run
    const msg = await prisma.message.findFirst({
      where: { runId: ctx.runId },
      select: { chatId: true },
    });

    if (!msg?.chatId) {
      // Fallback: try via objectiveId
      const objMsg = await prisma.message.findFirst({
        where: { objectiveId: ctx.objectiveId },
        select: { chatId: true },
      });
      if (!objMsg?.chatId) {
        return { success: false, output: null, error: "Could not determine chat context" };
      }
      if (mode === "list") return listRuns(objMsg.chatId, ctx.runId);
      const targetId = (input.runId as string) || await getMostRecentRunId(objMsg.chatId, ctx.runId);
      if (!targetId) return { success: true, output: { report: "No previous runs found in this chat." } };
      return detailRun(targetId);
    }

    if (mode === "list") {
      return listRuns(msg.chatId, ctx.runId);
    }

    const targetRunId = (input.runId as string) || await getMostRecentRunId(msg.chatId, ctx.runId);
    if (!targetRunId) {
      return { success: true, output: { report: "No previous runs found in this chat." } };
    }
    return detailRun(targetRunId);
  };
};

async function getMostRecentRunId(chatId: string, excludeRunId: string): Promise<string | null> {
  const msg = await prisma.message.findFirst({
    where: {
      chatId,
      runId: { not: null, notIn: [excludeRunId] },
    },
    orderBy: { createdAt: "desc" },
    select: { runId: true },
  });
  return msg?.runId ?? null;
}
