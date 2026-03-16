import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

type Params = { params: Promise<{ provider: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  const integration = await prisma.mcpIntegration.findUnique({ where: { provider } });
  if (!integration) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tools = await prisma.tool.findMany({
    where: { createdBy: provider, enabled: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(tools);
}
