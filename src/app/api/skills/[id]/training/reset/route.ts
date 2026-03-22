import { NextResponse } from "next/server";
import { resetTraining, clearTrainingEpochs } from "@/lib/training/queries";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    if (body.clearEpochs) {
      await clearTrainingEpochs(id);
    } else {
      await resetTraining(id);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
