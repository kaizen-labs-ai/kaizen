import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; epochId: string }> },
) {
  const { epochId } = await params;

  const epoch = await prisma.trainingEpoch.findUnique({
    where: { id: epochId },
    include: { snapshot: true },
  });

  if (!epoch) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ epoch });
}
