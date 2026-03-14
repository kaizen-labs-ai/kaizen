import { getAllChats } from "@/lib/chats/registry";
import { serialize } from "@/lib/db/serialize";
import { ChatsPageClient, type ChatListItem } from "./chats-page-client";

export default async function ChatsPage() {
  const chats = await getAllChats();
  return <ChatsPageClient initialData={serialize(chats) as unknown as ChatListItem[]} />;
}
