import { NextResponse } from "next/server";
import {
  getGuardrailsForSkill,
  createGuardrail,
  updateGuardrail,
  deleteGuardrail,
} from "@/lib/skills/guardrails";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guardrails = await getGuardrailsForSkill(id);
  return NextResponse.json(guardrails);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { rule, type, editableBy } = body;

  if (!rule || !type) {
    return NextResponse.json({ error: "rule and type are required" }, { status: 400 });
  }

  const guardrail = await createGuardrail({ skillId: id, rule, type, editableBy });
  return NextResponse.json(guardrail, { status: 201 });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const { guardrailId, rule, type, editableBy } = body;

  if (!guardrailId) {
    return NextResponse.json({ error: "guardrailId is required" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (rule !== undefined) data.rule = rule;
  if (type !== undefined) data.type = type;
  if (editableBy !== undefined) data.editableBy = editableBy;

  const guardrail = await updateGuardrail(guardrailId, data);
  return NextResponse.json(guardrail);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const guardrailId = searchParams.get("guardrailId");

  if (!guardrailId) {
    return NextResponse.json({ error: "guardrailId query param is required" }, { status: 400 });
  }

  await deleteGuardrail(guardrailId);
  return NextResponse.json({ success: true });
}
