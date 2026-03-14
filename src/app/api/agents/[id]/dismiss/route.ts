import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { AGENT_DEFAULTS } from "@/lib/agents/defaults";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const defaults = AGENT_DEFAULTS.find((a) => a.id === id);
  if (!defaults) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Acknowledge the update without changing the prompt
  const agent = await prisma.agentConfig.update({
    where: { id },
    data: { promptVersion: defaults.promptVersion },
  });

  return NextResponse.json(agent);
}
