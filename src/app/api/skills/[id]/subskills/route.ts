import { NextResponse } from "next/server";
import { updateSkillSubSkills } from "@/lib/skills/registry";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { subSkills } = body;

  if (!Array.isArray(subSkills)) {
    return NextResponse.json({ error: "subSkills must be an array" }, { status: 400 });
  }

  const skill = await updateSkillSubSkills(id, subSkills);
  return NextResponse.json(skill);
}
