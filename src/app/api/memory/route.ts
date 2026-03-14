import { NextResponse } from "next/server";
import { getUserMemory, setUserMemory, appendUserMemory } from "@/lib/memory/user-memory";

export async function GET() {
  const content = await getUserMemory();
  return NextResponse.json({ content });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const { content } = body;
  if (content === undefined) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  await setUserMemory(content);
  return NextResponse.json({ success: true });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { facts } = body;
  if (!facts) {
    return NextResponse.json({ error: "facts is required" }, { status: 400 });
  }
  const content = await appendUserMemory(facts);
  return NextResponse.json({ content });
}
