import { NextResponse } from "next/server";
import { updateSkillTools } from "@/lib/skills/registry";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { toolIds, toolType } = body;

  if (!Array.isArray(toolIds)) {
    return NextResponse.json({ error: "toolIds must be an array" }, { status: 400 });
  }

  const skill = await updateSkillTools(id, toolIds, toolType);
  return NextResponse.json(skill);
}
