"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Wifi,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { FaBraveReverse } from "react-icons/fa6";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { Skeleton } from "@/components/ui/skeleton";
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

interface BraveTool {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

const BRAVE_TOOL_NAMES = ["brave-search", "brave-instant", "brave-image-search", "brave-news-search", "brave-video-search"];

const BRAVE_TOOL_INFO: Record<string, { label: string; description: string }> = {
  "brave-search": {
    label: "brave-search",
    description: "Web search with structured results (titles, URLs, descriptions, snippets). For general research and lookups.",
  },
  "brave-instant": {
    label: "brave-instant",
    description: "Real-time data for crypto prices, stock quotes, weather, and currency conversions. Returns structured data from CoinGecko, OpenWeatherMap, and more.",
  },
  "brave-image-search": {
    label: "brave-image-search",
    description: "Image search returning direct URLs, thumbnails, and dimensions. Use with download-image to save results as artifacts.",
  },
  "brave-news-search": {
    label: "brave-news-search",
    description: "News search returning recent articles with age, source, and thumbnails. Supports freshness filters.",
  },
  "brave-video-search": {
    label: "brave-video-search",
    description: "Video search returning URLs, thumbnails, duration, view counts, and creator info.",
  },
};

export function BraveClient({
  initialData,
}: {
  initialData: Integration | null;
}) {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const { data: integration, isLoading: loading } = useQuery<Integration | null>({
    queryKey: ["integration", "brave"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/brave");
      if (!res.ok) return null;
      return res.json();
    },
    initialData,
    staleTime: 0,
  });

  const { data: allTools = [] } = useQuery<BraveTool[]>({
    queryKey: ["tools"],
    queryFn: async () => {
      const res = await fetch("/api/tools");
      if (!res.ok) return [];
      return res.json();
    },
  });
  const braveTools = allTools.filter((t) => BRAVE_TOOL_NAMES.includes(t.name));

  const isConnected = integration?.status === "connected";

  async function handleConnect() {
    if (!apiKey.trim()) {
      toast.error("Please enter your Brave Search API key");
      return;
    }
    setConnecting(true);
    try {
      const res = await fetch("/api/integrations/brave/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Connection failed");
        return;
      }
      toast.success("Brave Search connected");
      setApiKey("");
      queryClient.invalidateQueries({ queryKey: ["integration", "brave"] });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      queryClient.invalidateQueries({ queryKey: ["tools"] });
    } catch {
      toast.error("Connection failed");
    } finally {
      setConnecting(false);
    }
  }

  async function handleToggleTool(toolId: string, toolName: string, enabled: boolean) {
    try {
      const res = await fetch(`/api/tools/${toolId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        toast.error("Failed to update tool");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      toast.success(`${toolName} ${enabled ? "enabled" : "disabled"}`);
    } catch {
      toast.error("Failed to update tool");
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await fetch("/api/integrations/brave/disconnect", { method: "POST" });
      toast.success("Brave Search disconnected");
      queryClient.invalidateQueries({ queryKey: ["integration", "brave"] });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      queryClient.invalidateQueries({ queryKey: ["tools"] });
    } catch {
      toast.error("Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  }

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
                <BreadcrumbPage>Brave Search</BreadcrumbPage>
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
              <Skeleton className="h-3.5 w-[85%]" />
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
              <BreadcrumbPage>Brave Search</BreadcrumbPage>
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
                <FaBraveReverse className="h-4 w-4" />
                Brave Search
              </h2>
              <p className="text-sm text-muted-foreground">
                Web search, real-time data, images, news, and video powered by Brave&apos;s
                independent index. Adds five tools including instant data for crypto, stocks, and weather.
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
                    Enter your Brave Search API key to connect. Get one at{" "}
                    <a
                      href="https://api-dashboard.search.brave.com/register"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-4 inline-flex items-center gap-1"
                    >
                      api-dashboard.search.brave.com
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The free tier includes $5/month in credits (~1,000 searches).
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
                    placeholder="Paste API key here..."
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
                    {integration?.keyHint && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Key: {integration.keyHint}
                      </p>
                    )}
                  </div>
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
                        <AlertDialogTitle>Disconnect Brave Search?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove your API key. The agent will fall back to
                          web-fetch and browser for search tasks. You can reconnect at any time.
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
            )}
          </div>

          {/* Tools — only visible when connected */}
          {isConnected && <div className="space-y-3">
            <h3 className="text-sm font-medium">Available Tools</h3>
            <div className="rounded-md border border-border divide-y divide-border">
              {BRAVE_TOOL_NAMES.map((name) => {
                const info = BRAVE_TOOL_INFO[name];
                const tool = braveTools.find((t) => t.name === name);
                const enabled = tool?.enabled ?? true;
                return (
                  <div key={name} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{info.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {info.description}
                      </p>
                    </div>
                    {tool && (
                      <Switch
                        checked={enabled}
                        onCheckedChange={(v) => handleToggleTool(tool.id, tool.name, v)}
                        className="shrink-0 mt-0.5"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>}
        </div>
      </ScrollArea>
    </div>
  );
}
