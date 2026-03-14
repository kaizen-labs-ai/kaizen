import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.chat.update({
    where: { id },
    data: { hasUnread: false },
  });
  return NextResponse.json({ ok: true });
}
