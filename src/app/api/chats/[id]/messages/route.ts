import { NextResponse } from "next/server";
import { createMessage } from "@/lib/chats/registry";
import { prisma } from "@/lib/db/prisma";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { role, content, objectiveId } = body;

  if (!role || !content) {
    return NextResponse.json({ error: "role and content are required" }, { status: 400 });
  }

  const message = await createMessage({
    chatId: id,
    role,
    content,
    objectiveId,
  });

  // Forward user messages to external platform (e.g. WhatsApp) if this chat is extension-linked
  if (role === "user" && content) {
    try {
      const extChat = await prisma.extensionChat.findUnique({
        where: { chatId: id },
        include: { extension: true },
      });
      if (extChat?.extension.enabled && extChat.extension.type === "whatsapp") {
        const { whatsappGateway } = await import("@/lib/extensions/whatsapp/gateway");
        await whatsappGateway.sendMessage(extChat.externalId, content);
      }
    } catch {
      // Best-effort — don't fail the message creation if WhatsApp send fails
    }
  }

  return NextResponse.json(message, { status: 201 });
}
