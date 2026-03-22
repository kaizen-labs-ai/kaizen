import { NextResponse } from "next/server";
import { getTrainingEpochs } from "@/lib/training/queries";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const { epochs, total } = await getTrainingEpochs(id, limit, offset);
  return NextResponse.json({ epochs, total });
}
