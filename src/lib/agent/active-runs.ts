/**
 * In-memory registry of active run AbortControllers + metadata.
 * Allows explicit stop via API without requiring the SSE connection.
 * Single-process only (SQLite constraint makes this fine).
 *
 * Uses globalThis to survive HMR module re-evaluation in dev
 * (same pattern as prisma.ts).
 */

interface ActiveRunInfo {
  controller: AbortController;
  chatId?: string;
  activityLabel: string;
}

const globalForRuns = globalThis as unknown as {
  activeRuns: Map<string, ActiveRunInfo> | undefined;
};

const activeRuns = globalForRuns.activeRuns ?? new Map<string, ActiveRunInfo>();

if (process.env.NODE_ENV !== "production") {
  globalForRuns.activeRuns = activeRuns;
}

export function registerRun(
  runId: string,
  controller: AbortController,
  chatId?: string,
): void {
  activeRuns.set(runId, { controller, chatId, activityLabel: "Thinking" });
}

export function unregisterRun(runId: string): void {
  activeRuns.delete(runId);
}

export function updateRunActivity(runId: string, label: string): void {
  const info = activeRuns.get(runId);
  if (info) info.activityLabel = label;
}

export function stopRun(runId: string): boolean {
  const info = activeRuns.get(runId);
  if (!info) return false;
  info.controller.abort();
  activeRuns.delete(runId);
  return true;
}

/** Returns active runs keyed by chatId for the chat list UI. */
export function getActiveRunsByChatId(): Map<string, { runId: string; label: string }> {
  const result = new Map<string, { runId: string; label: string }>();
  for (const [runId, info] of activeRuns) {
    if (info.chatId) {
      result.set(info.chatId, { runId, label: info.activityLabel });
    }
  }
  return result;
}
