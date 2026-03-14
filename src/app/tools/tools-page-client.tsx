"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Terminal, Plug, Search, Wrench, Brain, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

interface Tool {
  id: string;
  name: string;
  description: string;
  type: string;
  enabled: boolean;
  memory: string | null;
}

const TYPE_ICONS: Record<string, typeof Terminal> = {
  system: Terminal,
  mcp: Plug,
};

export function ToolsPageClient({ initialData }: { initialData: Tool[] }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: tools = [], isLoading: loading } = useQuery<Tool[]>({
    queryKey: ["tools"],
    queryFn: async () => {
      const res = await fetch("/api/tools");
      return res.json();
    },
    initialData,
    staleTime: 0,
  });

  const filtered = tools.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase())
  );

  async function handleToggle(tool: Tool) {
    await fetch(`/api/tools/${tool.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !tool.enabled }),
    });
    queryClient.invalidateQueries({ queryKey: ["tools"] });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Tools</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <ScrollArea className="flex-1 overflow-hidden p-4">
        <div className="mx-auto w-full max-w-xl">
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
                placeholder="Search tools..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}

          <div className="text-xs text-muted-foreground mb-3">
            {loading ? (
              <Skeleton className="h-3 w-16" />
            ) : (
              <span>{filtered.length} tool{filtered.length !== 1 ? "s" : ""}</span>
            )}
          </div>

          {loading ? (
            <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3">
                  <Skeleton className="h-4 w-4 rounded shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-[40%]" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-[70%]" />
                  </div>
                  <Skeleton className="h-5 w-9 rounded-full shrink-0" />
                </div>
              ))}
            </div>
          ) : filtered.length > 0 ? (
            <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
              {filtered.map((tool) => {
                const Icon = TYPE_ICONS[tool.type] ?? Terminal;
                const hasMemory = !!(tool.memory && tool.memory.trim());
                return (
                  <Link
                    key={tool.id}
                    href={`/tools/${tool.id}`}
                    className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {tool.name}
                        </span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {tool.type}
                        </Badge>
                        {hasMemory && (
                          <Badge variant="secondary" className="text-xs shrink-0 gap-1">
                            <Brain className="h-3 w-3" />
                            memory
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {tool.description}
                      </p>
                    </div>
                    <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                      <Switch
                        checked={tool.enabled}
                        onCheckedChange={() => handleToggle(tool)}
                      />
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="flex h-[40vh] items-center justify-center text-muted-foreground">
              {tools.length === 0 ? (
                <div className="text-center">
                  <Wrench className="mx-auto mb-2 h-8 w-8" />
                  <p>No tools yet</p>
                  <p className="mt-1 text-xs">
                    System and MCP tools appear here automatically
                  </p>
                </div>
              ) : (
                "No tools match your search."
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
