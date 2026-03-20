"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageSquare,
  CalendarClock,
  BookOpen,
  Wrench,
  CodeXml,
  Puzzle,
  KeyRound,
  FolderOpen,
  Send,
  Bug,
  Settings,
  Plus,
  BarChart3,
  Bot,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

type NavItem = { href: string; label: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>> };

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Home",
    items: [{ href: "/chats", label: "Chats", icon: MessageSquare }],
  },
  {
    label: "Automate",
    items: [
      { href: "/schedules", label: "Schedules", icon: CalendarClock },
    ],
  },
  {
    label: "Extend",
    items: [
      { href: "/skills", label: "Skills", icon: BookOpen },
      { href: "/plugins", label: "Plugins", icon: CodeXml },
      { href: "/tools", label: "Tools", icon: Wrench },
      { href: "/extensions", label: "Extensions", icon: Puzzle },
    ],
  },
  {
    label: "Vault",
    items: [
      { href: "/secrets", label: "Secrets", icon: KeyRound },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/channels", label: "Channels", icon: Send },
      { href: "/outputs", label: "Outputs", icon: FolderOpen },
      { href: "/usage", label: "Usage", icon: BarChart3 },
      { href: "/settings/agents", label: "Settings", icon: Settings },
    ],
  },
];

const CREATE_LINKS: Record<string, string> = {
  "/chats": "/chats/new",
  "/schedules": "/schedules/new",
  "/skills": "/skills/new",
  "/plugins": "/plugins?create",
  "/secrets": "/secrets?create",
};

/**
 * Subscribe to server-pushed chat events via SSE.
 * Dispatches window events so all components (chat list, sidebar) react instantly.
 */
function useChatEventStream() {
  const retryDelay = useRef(1000);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;

    function connect() {
      if (closed) return;
      es = new EventSource("/api/events/chats");

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          // Dispatch with chatId detail so the open chat view can react to its own updates
          window.dispatchEvent(
            new CustomEvent("chat-server-event", { detail: event }),
          );
          // Only dispatch unread refresh for events that actually affect unread state
          const t = event.type as string;
          if (t === "chat-unread" || t === "chat-created" || t === "chat-updated" || t === "run-complete") {
            window.dispatchEvent(new Event("chat-unread"));
          }
        } catch { /* ignore bad data */ }
      };

      es.onopen = () => {
        retryDelay.current = 1000; // reset backoff on success
      };

      es.onerror = () => {
        es?.close();
        if (!closed) {
          // Reconnect with backoff
          setTimeout(connect, retryDelay.current);
          retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
        }
      };
    }

    connect();

    // Close SSE on page unload to free HTTP connection before reload
    const onUnload = () => {
      closed = true;
      es?.close();
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      closed = true;
      es?.close();
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);
}

function useUnreadCount(): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/chats/unread");
      if (res.ok) {
        const data = await res.json();
        setCount(data.count);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refresh();

    // Event-driven only — SSE pushes chat-unread, loadChat dispatches chat-read
    const onUpdate = () => refresh();
    window.addEventListener("chat-read", onUpdate);
    window.addEventListener("chat-unread", onUpdate);

    return () => {
      window.removeEventListener("chat-read", onUpdate);
      window.removeEventListener("chat-unread", onUpdate);
    };
  }, [refresh]);

  return count;
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { state } = useSidebar();
  const unreadCount = useUnreadCount();

  // SSE stream — dispatches window events for all listeners
  useChatEventStream();

  return (
    <Sidebar collapsible="icon" side="left">
      <SidebarHeader className="min-h-[57px] justify-center">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="hover:bg-transparent active:bg-transparent cursor-default flex justify-between">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 shrink-0 text-white -translate-y-[1px]" />
                <span className="text-base font-semibold text-white">Kaizen</span>
              </div>
              <span className="translate-y-[2px] rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">v{require("../../../package.json").version}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const matchPath = item.href === "/settings/agents" ? "/settings" : item.href;
                  const isActive = pathname.startsWith(matchPath);
                  const showBadge = item.href === "/chats" && unreadCount > 0;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.label}
                        className={CREATE_LINKS[item.href] ? "group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground" : undefined}
                      >
                        <Link href={item.href} onClick={(e) => { if (pathname === item.href) e.preventDefault(); }}>
                          {showBadge ? (
                            <div className="relative h-4 w-4 shrink-0">
                              <item.icon className="h-4 w-4" />
                              <span className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold leading-none text-destructive-foreground">
                                {unreadCount > 9 ? "9+" : unreadCount}
                              </span>
                            </div>
                          ) : (
                            <item.icon />
                          )}
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {CREATE_LINKS[item.href] && state === "expanded" && (
                        <SidebarMenuAction
                          className="md:opacity-0 group-hover/menu-item:opacity-100 !text-muted-foreground hover:!text-foreground transition-colors"
                          onClick={(e) => {
                            e.preventDefault();
                            const target = CREATE_LINKS[item.href];
                            if (pathname.startsWith("/chats/") && target === "/chats/new") {
                              // Reset chat in-place — avoids startTransition which gets blocked by streaming
                              window.dispatchEvent(new Event("new-chat-reset"));
                              window.history.pushState(null, "", "/chats/new");
                            } else {
                              router.push(target);
                            }
                          }}
                        >
                          <Plus />
                        </SidebarMenuAction>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname.startsWith("/logs")}
              tooltip="Logs"
            >
              <Link href="/logs" onClick={(e) => { if (pathname === "/logs") e.preventDefault(); }}>
                <Bug />
                <span>Logs</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
