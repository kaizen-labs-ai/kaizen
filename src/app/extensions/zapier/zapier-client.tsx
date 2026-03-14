"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Wifi,
  WifiOff,
  Loader2,
  RefreshCw,
  ExternalLink,
  Search,
  ChevronRight,
  Settings2,
  Puzzle,
} from "lucide-react";
import { TbBrandZapier } from "react-icons/tb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface Integration {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  status: string;
  statusMsg: string | null;
  vaultKey: string;
  config: string;
  hasKey: boolean;
  keyHint: string | null;
}

interface ToolItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  config: string;
}

interface ZapierConfig {
  mcpEndpoint?: string;
  lastSyncAt?: string;
  toolCount?: number;
}

function parseConfig(raw: string): ZapierConfig {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Parse tool config JSON safely. */
function parseToolConfig(raw: string): { appSlug?: string; appName?: string } {
  try { return JSON.parse(raw); } catch { return {}; }
}

/** Extract the app slug from tool config or fall back to name parsing. */
export function extractAppSlug(tool: ToolItem): string {
  const cfg = parseToolConfig(tool.config ?? "{}");
  if (cfg.appSlug) return cfg.appSlug;
  // Fallback: first segment after zapier_ prefix
  const withoutPrefix = (tool.name ?? "").replace(/^zapier_/, "");
  return withoutPrefix.split("_")[0] || "other";
}

/** Get human-readable app name from tool config or capitalize slug. */
export function formatAppName(slug: string, tools?: ToolItem[]): string {
  // Try to find appName from any tool's config in this group
  if (tools?.length) {
    const cfg = parseToolConfig(tools[0].config);
    if (cfg.appName) return cfg.appName;
  }
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Meta tools that shouldn't appear in app grouping */
const META_TOOLS = new Set(["zapier_get_configuration_url"]);

/** Group tools into apps, filtering out meta tools. */
function groupToolsIntoApps(tools: ToolItem[]): { slug: string; name: string; toolCount: number; enabledCount: number; toolIds: string[] }[] {
  const map = new Map<string, { total: number; enabled: number; ids: string[]; tools: ToolItem[] }>();
  for (const tool of tools) {
    if (META_TOOLS.has(tool.name)) continue;
    const slug = extractAppSlug(tool);
    const entry = map.get(slug) ?? { total: 0, enabled: 0, ids: [], tools: [] };
    entry.total++;
    if (tool.enabled) entry.enabled++;
    entry.ids.push(tool.id);
    entry.tools.push(tool);
    map.set(slug, entry);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, counts]) => ({
      slug,
      name: formatAppName(slug, counts.tools),
      toolCount: counts.total,
      enabledCount: counts.enabled,
      toolIds: counts.ids,
    }));
}

export function ZapierClient({
  initialData,
}: {
  initialData: {
    integration: Integration | null;
    tools: ToolItem[];
  };
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [appSearch, setAppSearch] = useState("");

  const { data: integration, isLoading: loadingIntegration } = useQuery<Integration | null>({
    queryKey: ["integration", "zapier"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/zapier");
      if (!res.ok) return null;
      return res.json();
    },
    initialData: initialData.integration,
    staleTime: 0,
  });

  const { data: tools = [], isLoading: loadingTools } = useQuery<ToolItem[]>({
    queryKey: ["integration-tools", "zapier"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/zapier/tools");
      return res.json();
    },
    initialData: initialData.tools,
    staleTime: 0,
  });

  const isConnected = integration?.status === "connected";
  const config = parseConfig(integration?.config ?? "{}");

  const apps = groupToolsIntoApps(tools);
  const filteredApps = apps.filter(
    (a) => a.name.toLowerCase().includes(appSearch.toLowerCase()),
  );

  async function handleConnect() {
    if (!apiKey.trim()) {
      toast.error("Please enter your Zapier MCP token");
      return;
    }
    setConnecting(true);
    try {
      const res = await fetch("/api/integrations/zapier/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Connection failed");
        return;
      }
      toast.success(`Connected — ${data.synced} tool${data.synced !== 1 ? "s" : ""} synced`);
      setApiKey("");
      queryClient.invalidateQueries({ queryKey: ["integration", "zapier"] });
      queryClient.invalidateQueries({ queryKey: ["integration-tools", "zapier"] });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    } catch {
      toast.error("Connection failed");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await fetch("/api/integrations/zapier/disconnect", { method: "POST" });
      toast.success("Zapier disconnected");
      queryClient.invalidateQueries({ queryKey: ["integration", "zapier"] });
      queryClient.invalidateQueries({ queryKey: ["integration-tools", "zapier"] });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    } catch {
      toast.error("Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/integrations/zapier/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Sync failed");
        return;
      }
      toast.success(`Synced — ${data.synced} tool${data.synced !== 1 ? "s" : ""}`);
      queryClient.invalidateQueries({ queryKey: ["integration", "zapier"] });
      queryClient.invalidateQueries({ queryKey: ["integration-tools", "zapier"] });
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleToggleApp(toolIds: string[], enabled: boolean) {
    try {
      await Promise.all(
        toolIds.map((id) =>
          fetch(`/api/tools/${id}`, {
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

  const loading = loadingIntegration;

  if (loading) {
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
                <BreadcrumbPage>Zapier</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </PageHeader>
        <ScrollArea className="flex-1 overflow-hidden p-4">
          <div className="max-w-xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-6 rounded shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-3.5 w-[75%]" />
              </div>
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <div className="rounded-lg border p-4 space-y-4">
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-[85%]" />
                <Skeleton className="h-3.5 w-[65%]" />
              </div>
              <Skeleton className="h-9 w-36 rounded-md" />
            </div>
          </div>
        </ScrollArea>
      </div>
    );
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
              <BreadcrumbPage>Zapier</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <ScrollArea className="flex-1 overflow-hidden p-4">
        <div className="max-w-xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <TbBrandZapier className="h-5 w-5 text-white" />
                Zapier
              </h2>
              <p className="text-sm text-muted-foreground">
                Connect 8,000+ apps through Zapier&apos;s MCP server.
                Each tool call uses 2 Zapier tasks from your plan.
              </p>
            </div>
            {integration?.status === "error" && (
              <Badge className="bg-red-600/20 text-red-400 border-red-600/30">
                Error
              </Badge>
            )}
          </div>

          {/* Connection Section */}
          <div className="rounded-lg border p-4 space-y-4">
            {!isConnected && (
              <>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Paste your Zapier MCP token to connect. You can create one at{" "}
                    <a
                      href="https://mcp.zapier.com/mcp/servers"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-4 inline-flex items-center gap-1"
                    >
                      mcp.zapier.com
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                  {integration?.status === "error" && integration.statusMsg && (
                    <p className="text-xs text-red-400">
                      Last error: {integration.statusMsg}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="Paste token here..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConnect();
                    }}
                    className="flex-1"
                  />
                  <Button onClick={handleConnect} disabled={connecting}>
                    {connecting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        Connecting
                      </>
                    ) : (
                      "Connect"
                    )}
                  </Button>
                </div>
              </>
            )}

            {isConnected && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <Wifi className="h-3.5 w-3.5 text-green-400" />
                      Connected
                    </p>
                    {config.lastSyncAt && (
                      <p className="text-xs text-muted-foreground">
                        Last sync: {new Date(config.lastSyncAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      asChild
                    >
                      <a
                        href="https://mcp.zapier.com/mcp/servers"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={disconnecting}
                        >
                          {disconnecting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Disconnect"
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Disconnect Zapier?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove your token and all synced tools. You can reconnect at any time.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={handleDisconnect}>
                            Disconnect
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Apps Section — only show when connected */}
          {isConnected && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  Apps ({apps.length})
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSync}
                  disabled={syncing}
                >
                  {syncing ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  )}
                  Sync
                </Button>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search apps..."
                  value={appSearch}
                  onChange={(e) => setAppSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {loadingTools ? (
                <div className="rounded-md border border-border divide-y divide-border">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      <Skeleton className="h-5 w-5 rounded shrink-0" />
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <Skeleton className="h-4 w-[30%]" />
                        <Skeleton className="h-3 w-[50%]" />
                      </div>
                      <Skeleton className="h-4 w-4 rounded shrink-0" />
                    </div>
                  ))}
                </div>
              ) : filteredApps.length > 0 ? (
                <div className="rounded-md border border-border divide-y divide-border">
                  {filteredApps.map((app) => (
                    <div
                      key={app.slug}
                      className="flex items-center gap-3 w-full px-3 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => router.push(`/extensions/zapier/${app.slug}`)}
                    >
                      <Puzzle className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{app.name}</span>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {app.toolCount} tool{app.toolCount !== 1 ? "s" : ""} available
                        </p>
                      </div>
                      <Switch
                        checked={app.enabledCount > 0}
                        onCheckedChange={(enabled) => handleToggleApp(app.toolIds, enabled)}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        className="shrink-0"
                      />
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  ))}
                </div>
              ) : apps.length > 0 ? (
                <div className="rounded-md border border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No apps match your search.
                </div>
              ) : (
                <div className="rounded-md border border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No apps discovered yet. Click Sync to discover available tools.
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
