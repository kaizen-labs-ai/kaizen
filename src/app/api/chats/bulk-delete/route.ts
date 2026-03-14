import { NextResponse } from "next/server";
import { deleteManyChats } from "@/lib/chats/registry";

export async function POST(req: Request) {
  const body = await req.json();
  const { ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array is required" }, { status: 400 });
  }

  await deleteManyChats(ids);
  return NextResponse.json({ success: true });
}
