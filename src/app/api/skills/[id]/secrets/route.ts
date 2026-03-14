import { NextResponse } from "next/server";
import { updateSkillVaultEntries } from "@/lib/skills/registry";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { vaultEntryIds } = body;

  if (!Array.isArray(vaultEntryIds)) {
    return NextResponse.json({ error: "vaultEntryIds must be an array" }, { status: 400 });
  }

  const skill = await updateSkillVaultEntries(id, vaultEntryIds);
  return NextResponse.json(skill);
}
