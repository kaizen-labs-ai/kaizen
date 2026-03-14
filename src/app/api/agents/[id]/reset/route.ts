import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { AGENT_DEFAULTS } from "@/lib/agents/defaults"; // v2

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const defaults = AGENT_DEFAULTS.find((a) => a.id === id);
  if (!defaults) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const agent = await prisma.agentConfig.update({
    where: { id },
    data: {
      systemPrompt: defaults.systemPrompt,
      customPrompt: null,
      promptVersion: defaults.promptVersion,
    },
  });

  return NextResponse.json(agent);
}
