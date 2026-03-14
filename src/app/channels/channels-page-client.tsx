"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { MessageSquareMore, ChevronRight, Search } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

interface ExtensionItem {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  status: string;
  contactCount?: number;
}

const CHANNEL_META: Record<string, { icon: React.ComponentType<{ className?: string }>; description: string }> = {
  whatsapp: {
    icon: FaWhatsapp,
    description: "Send and receive messages through WhatsApp using your own number.",
  },
};

export function ChannelsPageClient({ initialData }: { initialData: ExtensionItem[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data: extensions = [], isLoading: loading } = useQuery<ExtensionItem[]>({
    queryKey: ["channels"],
    queryFn: async () => {
      const res = await fetch("/api/extensions");
      return res.json();
    },
    initialData,
    staleTime: 0,
  });

  const filtered = extensions.filter(
    (ext) =>
      ext.name.toLowerCase().includes(search.toLowerCase()) ||
      ext.type.toLowerCase().includes(search.toLowerCase()),
  );

  function statusBadge(ext: ExtensionItem) {
    if (!ext.enabled) return <Badge variant="secondary">Disabled</Badge>;
    if (ext.status === "connected") return <Badge className="bg-green-600/20 text-green-400 border-green-600/30">Connected</Badge>;
    if (ext.status === "connecting") return <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30">Connecting</Badge>;
    return <Badge variant="secondary">Disconnected</Badge>;
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Channels</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <ScrollArea className="flex-1 overflow-hidden p-4">
        <div className="max-w-xl mx-auto">
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
                placeholder="Search channels..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}

          {loading ? (
            <>
              <Skeleton className="h-3 w-24 mb-3" />
              <div className="rounded-md border border-border divide-y divide-border">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <Skeleton className="h-5 w-5 rounded shrink-0" />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-[30%]" />
                        <Skeleton className="h-5 w-20 rounded-full" />
                      </div>
                      <Skeleton className="h-3 w-[70%]" />
                    </div>
                    <Skeleton className="h-4 w-4 rounded shrink-0" />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
            <p className="text-xs text-muted-foreground mb-3">
              {filtered.length} channel{filtered.length !== 1 ? "s" : ""}
            </p>
            <div className="rounded-md border border-border divide-y divide-border">
              {filtered.map((ext) => {
                const meta = CHANNEL_META[ext.type];
                const Icon = meta?.icon ?? MessageSquareMore;
                return (
                  <button
                    key={ext.id}
                    onClick={() => router.push(`/channels/${ext.type}`)}
                    className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                  >
                    <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{ext.name}</span>
                        {ext.contactCount != null && ext.contactCount > 0 && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {ext.contactCount} contact{ext.contactCount !== 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                      {meta && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {meta.description}
                        </p>
                      )}
                    </div>
                    {statusBadge(ext)}
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No channels found.
                </div>
              )}
            </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
