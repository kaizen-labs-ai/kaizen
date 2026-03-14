"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Puzzle, ChevronRight, Search } from "lucide-react";
import { TbBrandZapier } from "react-icons/tb";
import { FaBraveReverse } from "react-icons/fa6";
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

interface IntegrationItem {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  status: string;
  statusMsg: string | null;
  hasKey: boolean;
  keyHint: string | null;
}

const INTEGRATION_META: Record<string, { icon: React.ComponentType<{ className?: string }>; description: string }> = {
  zapier: {
    icon: TbBrandZapier,
    description: "Connect 8,000+ apps through Zapier's automation platform.",
  },
  brave: {
    icon: FaBraveReverse,
    description: "Fast web and image search powered by Brave's independent index.",
  },
};

export function ExtensionsPageClient({ initialData }: { initialData: IntegrationItem[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data: integrations = [], isLoading: loading } = useQuery<IntegrationItem[]>({
    queryKey: ["integrations"],
    queryFn: async () => {
      const res = await fetch("/api/integrations");
      return res.json();
    },
    initialData,
    staleTime: 0,
  });

  const filtered = integrations.filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.provider.toLowerCase().includes(search.toLowerCase()),
  );

  function statusBadge(item: IntegrationItem) {
    if (item.status === "connected")
      return (
        <Badge className="bg-green-600/20 text-green-400 border-green-600/30">
          Connected
        </Badge>
      );
    if (item.status === "connecting")
      return (
        <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30">
          Connecting
        </Badge>
      );
    if (item.status === "error")
      return (
        <Badge className="bg-red-600/20 text-red-400 border-red-600/30">
          Error
        </Badge>
      );
    return <Badge variant="secondary">Disconnected</Badge>;
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Extensions</BreadcrumbPage>
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
                placeholder="Search extensions..."
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
                {filtered.length} extension{filtered.length !== 1 ? "s" : ""}
              </p>
              <div className="rounded-md border border-border divide-y divide-border">
                {filtered.map((item) => {
                  const meta = INTEGRATION_META[item.provider];
                  const Icon = meta?.icon ?? Puzzle;
                  return (
                    <button
                      key={item.id}
                      onClick={() => router.push(`/extensions/${item.provider}`)}
                      className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                    >
                      <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{item.name}</span>
                          {item.statusMsg && item.status === "connected" && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              {item.statusMsg}
                            </Badge>
                          )}
                        </div>
                        {meta && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {meta.description}
                          </p>
                        )}
                      </div>
                      {statusBadge(item)}
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No extensions found.
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
