import { NextResponse } from "next/server";
import { getAllSkillsAdmin, createSkill } from "@/lib/skills/registry";
import { parseDeepLearningConfig } from "@/lib/training/types";

export async function GET() {
  const skills = await getAllSkillsAdmin();
  // Append dlStatus for UI badges
  const enriched = skills.map((s) => {
    const dl = parseDeepLearningConfig((s as { deepLearning?: string }).deepLearning ?? "{}");
    return { ...s, dlStatus: dl.enabled ? dl.status : null };
  });
  return NextResponse.json(enriched);
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
