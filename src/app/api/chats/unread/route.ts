import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const count = await prisma.chat.count({
    where: { hasUnread: true },
  });
  return NextResponse.json({ count });
}
