import { NextResponse } from "next/server";
import {
  getChatWithMessages,
  updateChatTitle,
  deleteChat,
} from "@/lib/chats/registry";
import { prisma } from "@/lib/db/prisma";
import { getActiveRunsByChatId } from "@/lib/agent/active-runs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chat = await getChatWithMessages(id);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Clear unread flag when user opens the chat
  if (chat.hasUnread) {
    await prisma.chat.update({
      where: { id },
      data: { hasUnread: false },
    });
  }

  // Include active run info so the client doesn't need a separate fetch
  const activeByChat = getActiveRunsByChatId();
  const activeRun = activeByChat.get(id) ?? null;

  return NextResponse.json({ ...chat, activeRun });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { title } = body;

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const chat = await updateChatTitle(id, title);
  return NextResponse.json(chat);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteChat(id);
  return NextResponse.json({ success: true });
}
