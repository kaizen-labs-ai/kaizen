"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Puzzle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbLink,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import { toast } from "sonner";

interface ToolItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  config: string;
}

function parseToolConfig(raw: string): { appSlug?: string; appName?: string } {
  try { return JSON.parse(raw); } catch { return {}; }
}

/** Strip "zapier_{appSlug}_" prefix → action words → "Send Email" */
function formatActionName(tool: ToolItem): string {
  const cfg = parseToolConfig(tool.config);
  const slug = cfg.appSlug;
  if (slug) {
    const prefix = `zapier_${slug}_`;
    if (tool.name.startsWith(prefix)) {
      const action = tool.name.slice(prefix.length);
      return action.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
    }
  }
  // Fallback: skip first segment after zapier_ prefix
  const withoutPrefix = tool.name.replace(/^zapier_/, "");
  const parts = withoutPrefix.split("_");
  const actionParts = parts.slice(1);
  if (actionParts.length === 0) return withoutPrefix;
  return actionParts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

function formatAppName(slug: string, tools?: ToolItem[]): string {
  if (tools?.length) {
    const cfg = parseToolConfig(tools[0].config);
    if (cfg.appName) return cfg.appName;
  }
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export function AppToolsClient({
  app,
  initialData,
}: {
  app: string;
  initialData: ToolItem[];
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const appName = formatAppName(app, initialData);

  const { data: tools = [], isLoading: loading } = useQuery<ToolItem[]>({
    queryKey: ["integration-tools", "zapier", app],
    queryFn: async () => {
      const res = await fetch("/api/integrations/zapier/tools");
      const all: ToolItem[] = await res.json();
      return all.filter((t) => t.name.startsWith(`zapier_${app}_`));
    },
    initialData,
    staleTime: 0,
  });

  const filtered = tools.filter(
    (t) =>
      formatActionName(t).toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase()),
  );

  const allEnabled = tools.length > 0 && tools.every((t) => t.enabled);

  async function handleToggleAll(enabled: boolean) {
    try {
      await Promise.all(
        tools.map((t) =>
          fetch(`/api/tools/${t.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled }),
          }),
        ),
      );
      queryClient.invalidateQueries({ queryKey: ["integration-tools", "zapier"] });
      toast.success(enabled ? "All tools enabled" : "All tools disabled");
    } catch {
      toast.error("Failed to update tools");
    }
  }

  async function handleToggle(toolId: string, enabled: boolean) {
    try {
      await fetch(`/api/tools/${toolId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      queryClient.invalidateQueries({ queryKey: ["integration-tools", "zapier"] });
      toast.success(enabled ? "Tool enabled" : "Tool disabled");
    } catch {
      toast.error("Failed to update tool");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/extensions">Extensions</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/extensions/zapier">Zapier</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{appName}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <ScrollArea className="flex-1 overflow-hidden p-4">
        <div className="max-w-xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Puzzle className="h-5 w-5 text-muted-foreground" />
              {appName}
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {allEnabled ? "Enabled" : "Disabled"}
              </span>
              <Switch
                checked={allEnabled}
                onCheckedChange={handleToggleAll}
              />
            </div>
          </div>

          {/* Search */}
          {loading ? (
            <div className="relative">
              <Skeleton className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 rounded" />
              <Skeleton className="h-9 w-full rounded-md !bg-transparent border border-border" />
              <Skeleton className="h-3 w-24 absolute left-9 top-1/2 -translate-y-1/2" />
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search tools..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}

          {/* Count */}
          {loading ? (
            <Skeleton className="h-3 w-20" />
          ) : (
            <p className="text-xs text-muted-foreground">
              {filtered.length} tool{filtered.length !== 1 ? "s" : ""}
            </p>
          )}

          {/* Tool list */}
          {loading ? (
            <div className="rounded-md border border-border divide-y divide-border">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3">
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <Skeleton className="h-3.5 w-[40%]" />
                    <Skeleton className="h-3 w-[70%]" />
                  </div>
                  <Skeleton className="h-5 w-9 rounded-full shrink-0" />
                </div>
              ))}
            </div>
          ) : filtered.length > 0 ? (
            <div className="rounded-md border border-border divide-y divide-border">
              {filtered.map((tool) => (
                <div
                  key={tool.id}
                  className="flex items-center gap-3 px-3 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {formatActionName(tool)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {tool.description}
                    </p>
                  </div>
                  <Switch
                    checked={tool.enabled}
                    onCheckedChange={(enabled) => handleToggle(tool.id, enabled)}
                  />
                </div>
              ))}
            </div>
          ) : tools.length > 0 ? (
            <div className="rounded-md border border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No tools match your search.
            </div>
          ) : (
            <div className="rounded-md border border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No tools found for this app.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
