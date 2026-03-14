import { NextResponse } from "next/server";
import { getAllSouls, upsertSoul, setActiveSoul } from "@/lib/agent/soul";

export async function GET() {
  const souls = await getAllSouls();
  return NextResponse.json(souls);
}

export async function POST(req: Request) {
  const body = await req.json();

  if (body.action === "setActive" && body.soulId) {
    await setActiveSoul(body.soulId);
    return NextResponse.json({ success: true });
  }

  const { name, description, traits } = body;
  if (!name || !description || !traits) {
    return NextResponse.json({ error: "name, description, and traits are required" }, { status: 400 });
  }

  const soul = await upsertSoul({ name, description, traits });
  return NextResponse.json(soul, { status: 201 });
}
