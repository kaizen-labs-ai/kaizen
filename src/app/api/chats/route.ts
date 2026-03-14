import { NextResponse } from "next/server";
import { getAllChats, createChat } from "@/lib/chats/registry";
import { chatEvents } from "@/lib/events/chat-events";

export async function GET() {
  const chats = await getAllChats();
  return NextResponse.json(chats);
}

export async function POST(req: Request) {
  const body = await req.json();
  const chat = await createChat(body.title);
  chatEvents.emit({ type: "chat-created", chatId: chat.id });
  return NextResponse.json(chat, { status: 201 });
}
