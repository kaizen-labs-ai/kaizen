"use client";

import { useRouter, usePathname } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NewChatFab() {
  const router = useRouter();
  const pathname = usePathname();

  // Hide on chat conversation pages (input area covers the FAB)
  if (pathname.startsWith("/chats/")) return null;

  return (
    <Button
      onClick={() => router.push("/chats/new")}
      variant="outline"
      size="icon"
      className="fixed bottom-6 right-6 h-12 w-12 rounded-full shadow-lg z-50 !bg-zinc-900 hover:!bg-zinc-800 border-border"
    >
      <MessageSquare className="h-5 w-5" />
    </Button>
  );
}
