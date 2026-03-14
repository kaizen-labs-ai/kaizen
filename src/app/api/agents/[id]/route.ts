import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { invalidateAgentConfigCache } from "@/lib/agents/defaults";
import { getAgentConfig } from "@/lib/agents/queries";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const agent = await getAgentConfig(id);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json(agent);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const agent = await prisma.agentConfig.findUnique({ where: { id } });
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const body = await req.json();
    const isSystem = agent.type === "system";
    const updates: Record<string, unknown> = {};

    // Model, thinking, timeout — editable for all agents
    if (body.model !== undefined) updates.model = body.model;
    if (body.imageModel !== undefined) updates.imageModel = body.imageModel || null;
    if (body.fileModel !== undefined) updates.fileModel = body.fileModel || null;
    if (body.audioModel !== undefined) updates.audioModel = body.audioModel || null;
    if (body.videoModel !== undefined) updates.videoModel = body.videoModel || null;
    if (body.thinking !== undefined) updates.thinking = body.thinking;
    if (body.timeout !== undefined) updates.timeout = Math.max(10, Math.min(600, Number(body.timeout) || 120));

    // Enabled — blocked for system agents (always on)
    if (body.enabled !== undefined && isSystem) {
      return NextResponse.json(
        { error: "System agents cannot be disabled" },
        { status: 403 }
      );
    }

    // System prompt — blocked for system agents
    if (body.systemPrompt !== undefined) {
      if (isSystem) {
        return NextResponse.json(
          { error: "System agent prompts are managed by the orchestration engine" },
          { status: 403 }
        );
      }
      updates.systemPrompt = body.systemPrompt;
      updates.customPrompt = body.systemPrompt;
    }

    const updated = await prisma.agentConfig.update({
      where: { id },
      data: updates,
    });

    // Invalidate the memoized ensureAgentConfigs cache so the next run
    // picks up the user's changes immediately.
    invalidateAgentConfigCache();

    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PATCH /api/agents/${id}]`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
