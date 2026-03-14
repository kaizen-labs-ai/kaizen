import { NextResponse } from "next/server";
import { generateChatTitle } from "@/lib/chats/registry";
import { createLog } from "@/lib/logs/logger";
import { prisma } from "@/lib/db/prisma";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { message } = body;

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // Skip titler for extension-linked chats — they use their own label
  const extChat = await prisma.extensionChat.findUnique({ where: { chatId: id } });
  if (extChat) {
    return NextResponse.json({ title: extChat.label });
  }

  try {
    const title = await generateChatTitle(id, message);
    return NextResponse.json({ title });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[titler] Failed to generate title for chat ${id}:`, errorMsg);
    createLog("error", "titler", `Failed to generate title: ${errorMsg}`, {
      chatId: id,
    }).catch(() => {});
    return NextResponse.json({ error: "Failed to generate title" }, { status: 500 });
  }
}
