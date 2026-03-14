"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Search, MoreVertical, Trash2, Edit2, X, MessageSquare } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { Checkbox } from "@/components/ui/checkbox";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatRelativeTime } from "@/lib/utils/time";

function previewText(content: string): string {
  // Extract plan proposal summary if present
  const planMatch = content.match(/<!--plan_proposal-->([\s\S]*)<!--\/plan_proposal-->/);
  if (planMatch) {
    try {
      const parsed = JSON.parse(planMatch[1]);
      if (parsed.summary) return parsed.summary.length <= 80 ? parsed.summary : parsed.summary.slice(0, 80).trim() + "\u2026";
    } catch { /* fall through */ }
  }
  const cleaned = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#*_~`>]/g, "")
    // Strip skill/plugin/schedule delimiters, keep the name inside
    .replace(/\x03scheduled\x03/g, "")
    .replace(/\x01([^\x02]*)\x02/g, "$1")
    .replace(/\x04([^\x05]*)\x05/g, "$1")
    .replace(/\n+/g, " ")
    .trim();
  if (cleaned.length <= 80) return cleaned;
  return cleaned.slice(0, 80).trim() + "\u2026";
}

export interface ChatListItem {
  id: string;
  title: string;
  hasUnread: boolean;
  updatedAt: string;
  messages: { role: string; content: string; createdAt: string }[];
  extensionChat?: { extension: { type: string } } | null;
}

export function ChatsPageClient({ initialData }: { initialData: ChatListItem[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renameChat, setRenameChat] = useState<ChatListItem | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const menuActionRef = useRef(false);

  // Always seed the cache with the server's fresh data on mount.
  // React Query's initialData is ignored when cache already has data, so
  // setQueryData ensures navigation always shows the latest server-fetched list.
  useState(() => { queryClient.setQueryData(["chats"], initialData); });

  const { data: chats = [], isLoading: loading } = useQuery<ChatListItem[]>({
    queryKey: ["chats"],
    queryFn: async () => {
      const res = await fetch("/api/chats");
      if (res.ok) return res.json();
      return [];
    },
  });

  const [activeRuns, setActiveRuns] = useState<Map<string, string>>(new Map());

  // One-time fetch on mount to recover active runs after page refresh
  useEffect(() => {
    let cancelled = false;
    fetch("/api/runs/active")
      .then((r) => r.json())
      .then((runs: { chatId: string; label: string }[]) => {
        if (cancelled) return;
        setActiveRuns(new Map(runs.map((r) => [r.chatId, r.label])));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Event-driven: listen to SSE-dispatched events for run lifecycle + chat updates
  useEffect(() => {
    const onServerEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.type) return;

      if (detail.type === "run-started" && detail.chatId) {
        setActiveRuns((prev) => {
          const next = new Map(prev);
          next.set(detail.chatId, "Thinking");
          return next;
        });
        // Refresh list so newly created chats appear immediately
        queryClient.invalidateQueries({ queryKey: ["chats"] });
      } else if (detail.type === "run-activity" && detail.chatId) {
        setActiveRuns((prev) => {
          const next = new Map(prev);
          next.set(detail.chatId, detail.label);
          return next;
        });
      } else if ((detail.type === "run-complete" || detail.type === "run-error") && detail.chatId) {
        setActiveRuns((prev) => {
          const next = new Map(prev);
          next.delete(detail.chatId);
          return next;
        });
        // Refresh chat list to pick up updated message preview
        queryClient.invalidateQueries({ queryKey: ["chats"] });
      }
    };

    const onChatUpdate = () => {
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    };

    window.addEventListener("chat-server-event", onServerEvent);
    window.addEventListener("chat-unread", onChatUpdate);
    window.addEventListener("chat-read", onChatUpdate);
    window.addEventListener("chat-list-changed", onChatUpdate);
    return () => {
      window.removeEventListener("chat-server-event", onServerEvent);
      window.removeEventListener("chat-unread", onChatUpdate);
      window.removeEventListener("chat-read", onChatUpdate);
      window.removeEventListener("chat-list-changed", onChatUpdate);
    };
  }, [queryClient]);

  const filtered = chats.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  function handleNewChat() {
    router.push("/chats/new");
  }

  async function handleDelete(id: string) {
    menuActionRef.current = true;
    await fetch(`/api/chats/${id}`, { method: "DELETE" });
    toast.success("Chat deleted");
    queryClient.invalidateQueries({ queryKey: ["chats"] });
    queryClient.invalidateQueries({ queryKey: ["artifacts"] });
    window.dispatchEvent(new Event("chat-unread"));
    setTimeout(() => { menuActionRef.current = false; }, 200);
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    await fetch("/api/chats/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected) }),
    });
    toast.success(`${selected.size} chat${selected.size > 1 ? "s" : ""} deleted`);
    setSelected(new Set());
    setSelectMode(false);
    queryClient.invalidateQueries({ queryKey: ["chats"] });
    queryClient.invalidateQueries({ queryKey: ["artifacts"] });
    window.dispatchEvent(new Event("chat-unread"));
  }

  async function handleRename() {
    if (!renameChat || !renameTitle.trim()) return;
    await fetch(`/api/chats/${renameChat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: renameTitle.trim() }),
    });
    toast.success("Chat renamed");
    setRenameChat(null);
    queryClient.invalidateQueries({ queryKey: ["chats"] });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <PageHeader
        actions={
          <Button variant="outline" size="sm" onClick={handleNewChat}>
            <Plus className="mr-1 h-4 w-4" /> New chat
          </Button>
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Chats</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <ScrollArea className="flex-1 overflow-hidden p-4">
        <div className="mx-auto w-full max-w-xl">
          {/* Search */}
          {loading ? (
            <div className="relative mb-4">
              <Skeleton className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 rounded" />
              <Skeleton className="h-9 w-full rounded-md !bg-transparent border border-border" />
              <Skeleton className="h-3 w-24 absolute left-9 top-1/2 -translate-y-1/2" />
            </div>
          ) : (
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats..."
                className="pl-9"
              />
            </div>
          )}

          {/* Count + Select toggle */}
          <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
            {loading ? (
              <Skeleton className="h-3 w-20" />
            ) : selectMode ? (
              <>
                <span>{selected.size} selected</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={handleBulkDelete}
                  disabled={selected.size === 0}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <div className="flex-1" />
                <Button variant="ghost" size="sm" className="h-6 px-2" onClick={exitSelectMode}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <>
                <span>
                  {filtered.length} chat{filtered.length !== 1 ? "s" : ""}
                </span>
                {chats.length > 0 && (
                  <button
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => setSelectMode(true)}
                  >
                    Select
                  </button>
                )}
              </>
            )}
          </div>

          {/* Chat list */}
          {loading ? (
            <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3">
                  <Skeleton className="h-4 w-4 rounded shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-baseline gap-2">
                      <Skeleton className="h-4 w-[60%]" />
                      <Skeleton className="h-3 w-10 ml-auto shrink-0" />
                    </div>
                    <Skeleton className="h-3 w-[80%]" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length > 0 ? (
            <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
              {filtered.map((chat) => (
                <div
                  key={chat.id}
                  className={`group flex items-center gap-3 px-3 py-3 hover:bg-muted/50 transition-colors cursor-pointer ${chat.hasUnread ? "bg-muted/30" : ""}`}
                  onClick={() => {
                    if (menuActionRef.current) return;
                    if (selectMode) {
                      toggleSelect(chat.id);
                    } else {
                      router.push(`/chats/${chat.id}`);
                    }
                  }}
                >
                  {selectMode && (
                    <Checkbox
                      checked={selected.has(chat.id)}
                      onCheckedChange={() => toggleSelect(chat.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}

                  {!selectMode && (
                    chat.extensionChat?.extension.type === "whatsapp"
                      ? <FaWhatsapp className="h-4 w-4 text-green-500 shrink-0" />
                      : <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}

                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-baseline gap-2">
                      <p className="text-sm font-medium truncate flex-1">{chat.title}</p>
                      <span className="text-xs text-muted-foreground/60 shrink-0">
                        {formatRelativeTime(chat.updatedAt)}
                      </span>
                    </div>
                    {(() => {
                      const lastMsg = chat.messages.find((m) => m.content);
                      if (activeRuns.has(chat.id)) {
                        return (
                          <p className="text-xs mt-0.5 animate-pulse" style={{ color: "#ce9178" }}>
                            {activeRuns.get(chat.id)}...
                          </p>
                        );
                      }
                      if (lastMsg) {
                        return (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {chat.hasUnread && (
                              <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                            )}
                            <p className="text-xs text-muted-foreground truncate">
                              {lastMsg.role === "user" ? "You: " : ""}
                              {previewText(lastMsg.content)}
                            </p>
                          </div>
                        );
                      }
                      if (chat.hasUnread) {
                        return (
                          <div className="mt-0.5">
                            <span className="h-2 w-2 inline-block rounded-full bg-blue-500" />
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  {!selectMode && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-muted-foreground/40 hover:text-muted-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            menuActionRef.current = true;
                            setRenameChat(chat);
                            setRenameTitle(chat.title);
                            setTimeout(() => { menuActionRef.current = false; }, 200);
                          }}
                        >
                          <Edit2 className="mr-2 h-3.5 w-3.5" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={(e) => {
                            e.preventDefault();
                            handleDelete(chat.id);
                          }}
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-[40vh] items-center justify-center text-muted-foreground">
              {chats.length === 0 ? (
                <div className="text-center">
                  <MessageSquare className="mx-auto mb-2 h-8 w-8" />
                  <p>No chats yet</p>
                  <p className="mt-1 text-xs">Start a conversation with the agent</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={handleNewChat}>
                    <Plus className="mr-1 h-4 w-4" /> New chat
                  </Button>
                </div>
              ) : (
                "No chats match your search."
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Rename dialog */}
      <Dialog open={!!renameChat} onOpenChange={(open) => !open && setRenameChat(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <Input
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              placeholder="Chat title"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRenameChat(null)}>
                Cancel
              </Button>
              <Button onClick={handleRename}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
