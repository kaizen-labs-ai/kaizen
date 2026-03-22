import { NextResponse } from "next/server";
import { rollbackToSnapshot } from "@/lib/training/queries";

export async function POST(req: Request) {
  const body = await req.json();
  const { epochId } = body;

  if (!epochId) {
    return NextResponse.json({ error: "epochId is required" }, { status: 400 });
  }

  try {
    await rollbackToSnapshot(epochId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
