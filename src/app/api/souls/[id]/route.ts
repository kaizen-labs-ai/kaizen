import { NextResponse } from "next/server";
import { upsertSoul, deleteSoul } from "@/lib/agent/soul";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, description, traits } = body;

  if (!name || !description || !traits) {
    return NextResponse.json({ error: "name, description, and traits are required" }, { status: 400 });
  }

  const soul = await upsertSoul({ id, name, description, traits });
  return NextResponse.json(soul);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteSoul(id);
  return NextResponse.json({ success: true });
}
