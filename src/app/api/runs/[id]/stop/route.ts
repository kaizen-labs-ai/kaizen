import { NextResponse } from "next/server";
import { stopRun } from "@/lib/agent/active-runs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const stopped = stopRun(id);

  if (!stopped) {
    return NextResponse.json(
      { error: "Run not found or already finished" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
