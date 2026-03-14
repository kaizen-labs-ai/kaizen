import { NextResponse } from "next/server";
import { getAllSkillsAdmin, createSkill } from "@/lib/skills/registry";

export async function GET() {
  const skills = await getAllSkillsAdmin();
  return NextResponse.json(skills);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, description, instructions, modelPref, toolIds, vaultEntryIds, guardrails } = body;

  if (!name || !description || !instructions) {
    return NextResponse.json(
      { error: "name, description, and instructions are required" },
      { status: 400 }
    );
  }

  const skill = await createSkill({
    name,
    description,
    instructions,
    modelPref,
    toolIds,
    vaultEntryIds,
    guardrails,
  });

  return NextResponse.json(skill, { status: 201 });
}
