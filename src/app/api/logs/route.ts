import { NextResponse } from "next/server";
import { getLogs, getLogCount, clearLogs, type LogLevel, type LogSource } from "@/lib/logs/logger";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const level = searchParams.get("level") as LogLevel | null;
  const source = searchParams.get("source") as LogSource | null;
  const runId = searchParams.get("runId");
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");

  const [logs, total] = await Promise.all([
    getLogs({
      ...(level && { level }),
      ...(source && { source }),
      ...(runId && { runId }),
      limit,
      offset,
    }),
    getLogCount({
      ...(level && { level }),
      ...(source && { source }),
    }),
  ]);

  return NextResponse.json({ logs, total });
}

export async function DELETE() {
  await clearLogs();
  return NextResponse.json({ success: true });
}
