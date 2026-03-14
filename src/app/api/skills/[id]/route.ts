import { NextResponse } from "next/server";
import { getSkillWithDetails, updateSkill, deleteSkill } from "@/lib/skills/registry";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const skill = await getSkillWithDetails(id);
  if (!skill) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(skill);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, description, instructions, modelPref, enabled } = body;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (instructions !== undefined) data.instructions = instructions;
  if (modelPref !== undefined) data.modelPref = modelPref;
  if (enabled !== undefined) data.enabled = enabled;

  const skill = await updateSkill(id, data);
  return NextResponse.json(skill);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteSkill(id);
  return NextResponse.json({ success: true });
}
