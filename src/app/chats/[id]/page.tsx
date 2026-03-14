import { getChatWithMessages } from "@/lib/chats/registry";
import { getActiveRunsByChatId } from "@/lib/agent/active-runs";
import { serialize } from "@/lib/db/serialize";
import { prisma } from "@/lib/db/prisma";
import { ChatView } from "@/components/chat/chat-view";
import type { ChatApiResponse } from "@/components/chat/chat-types";

export default async function ChatDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const chat = await getChatWithMessages(id);

  if (!chat) {
    return <ChatView key={id} chatId={id} />;
  }

  // Clear unread flag when user opens the chat
  if (chat.hasUnread) {
    await prisma.chat.update({
      where: { id },
      data: { hasUnread: false },
    });
  }

  // Include active run info (same process, in-memory map)
  const activeByChat = getActiveRunsByChatId();
  const activeRun = activeByChat.get(id) ?? null;

  const initialData = serialize({ ...chat, activeRun }) as unknown as ChatApiResponse;
  return <ChatView key={id} chatId={id} initialChatData={initialData} />;
}
