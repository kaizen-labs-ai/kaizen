import { NextResponse } from "next/server";
import { getActiveRunsByChatId } from "@/lib/agent/active-runs";
import { cleanupStaleRuns } from "@/lib/agent/orchestrator";

export const dynamic = "force-dynamic";

export async function GET() {
  // Eagerly clean up zombie runs from previous server sessions.
  // No-ops after the first successful call.
  await cleanupStaleRuns();

  const activeByChat = getActiveRunsByChatId();
  const result: { chatId: string; runId: string; label: string }[] = [];
  for (const [chatId, info] of activeByChat) {
    result.push({ chatId, runId: info.runId, label: info.label });
  }
  return NextResponse.json(result);
}
