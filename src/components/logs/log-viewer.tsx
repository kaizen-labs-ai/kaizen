"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, ChevronDown, ChevronRight, ListFilter, Copy, Check } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import { toast } from "sonner";

interface LogEntry {
  id: string;
  level: string;
  source: string;
  message: string;
  meta: string;
  runId: string | null;
  chatId: string | null;
  createdAt: string;
}

const LEVEL_COLORS: Record<string, string> = {
  debug: "bg-zinc-500/20 text-zinc-400",
  info: "bg-blue-500/20 text-blue-400",
  warn: "bg-yellow-500/20 text-yellow-400",
  error: "bg-red-500/20 text-red-400",
};

const SOURCE_COLORS: Record<string, string> = {
  orchestrator: "bg-purple-500/20 text-purple-400",
  tool: "bg-green-500/20 text-green-400",
  openrouter: "bg-orange-500/20 text-orange-400",
  system: "bg-cyan-500/20 text-cyan-400",
};

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  }) + " " + d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function LogRow({ log }: { log: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  let meta: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(log.meta);
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
      meta = parsed;
    }
  } catch {
    // ignore
  }

  return (
    <div
      className={`border-b border-border/50 px-3 py-2 text-sm hover:bg-accent/30 transition-colors overflow-hidden ${meta ? "cursor-pointer" : ""}`}
      onClick={() => meta && setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        {/* Expand toggle */}
        <span className="shrink-0 text-muted-foreground">
          {meta ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <div className="w-3.5" />
          )}
        </span>

        {/* Timestamp */}
        <span className="shrink-0 text-[11px] text-muted-foreground font-mono w-36">
          {formatTimestamp(log.createdAt)}
        </span>

        {/* Level badge */}
        <Badge
          variant="secondary"
          className={`shrink-0 text-[10px] px-1.5 py-0 uppercase font-mono ${LEVEL_COLORS[log.level] ?? ""}`}
        >
          {log.level}
        </Badge>

        {/* Source badge */}
        <Badge
          variant="secondary"
          className={`shrink-0 text-[10px] px-1.5 py-0 font-mono ${SOURCE_COLORS[log.source] ?? ""}`}
        >
          {log.source}
        </Badge>

        {/* Message */}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{log.message}</span>

        {/* Chat ID */}
        {log.chatId && (
          <span
            className="shrink-0 text-[10px] text-muted-foreground font-mono cursor-pointer hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(`chat:${log.chatId}`);
              toast.success("Chat ID copied");
            }}
            title={log.chatId}
          >
            chat:{log.chatId.slice(0, 8)}
          </span>
        )}

        {/* Run ID */}
        {log.runId && (
          <span
            className="shrink-0 text-[10px] text-muted-foreground font-mono cursor-pointer hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(`run:${log.runId}`);
              toast.success("Run ID copied");
            }}
            title={log.runId}
          >
            run:{log.runId.slice(0, 8)}
          </span>
        )}
      </div>

      {/* Expanded meta */}
      {expanded && meta && (
        <div onClick={(e) => e.stopPropagation()} className="group/meta relative mt-2 ml-6">
          <button
            className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover/meta:opacity-100"
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(meta, null, 2));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <pre className="rounded bg-muted/50 p-2 pr-8 text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">
            {JSON.stringify(meta, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function LogViewer({ initialData }: { initialData?: { logs: LogEntry[]; total: number } }) {
  const queryClient = useQueryClient();
  const [levelFilter, setLevelFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  // initialData only seeds the default "all/all" query — filtered queries fetch normally
  const isDefaultFilter = levelFilter === "all" && sourceFilter === "all";

  const { data: logsData, isLoading: loading } = useQuery<{ logs: LogEntry[]; total: number }>({
    queryKey: ["logs", levelFilter, sourceFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "500" });
      if (levelFilter !== "all") params.set("level", levelFilter);
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      const res = await fetch(`/api/logs?${params}`);
      return res.json();
    },
    ...(isDefaultFilter && initialData ? { initialData, staleTime: 0 } : {}),
  });

  // SSE: invalidate logs query when new logs arrive
  const retryDelay = useRef(1000);
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;

    function connect() {
      if (closed) return;
      es = new EventSource("/api/events/logs");

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === "log-created" || event.type === "logs-cleared") {
            queryClient.invalidateQueries({ queryKey: ["logs"] });
          }
        } catch { /* ignore bad data */ }
      };

      es.onopen = () => { retryDelay.current = 1000; };

      es.onerror = () => {
        es?.close();
        if (!closed) {
          setTimeout(connect, retryDelay.current);
          retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
        }
      };
    }

    connect();
    const onUnload = () => { closed = true; es?.close(); };
    window.addEventListener("beforeunload", onUnload);
    return () => { closed = true; es?.close(); window.removeEventListener("beforeunload", onUnload); };
  }, [queryClient]);

  const logs = logsData?.logs ?? [];
  const total = logsData?.total ?? 0;

  async function handleClear() {
    await fetch("/api/logs", { method: "DELETE" });
    toast.success("Logs cleared");
    queryClient.invalidateQueries({ queryKey: ["logs"] });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Logs</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <div className="flex-1 overflow-hidden p-4 flex flex-col gap-3">
      {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger size="sm">
              <SelectValue>
                {levelFilter === "all" ? "All levels" : levelFilter.charAt(0).toUpperCase() + levelFilter.slice(1)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="debug">Debug</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger size="sm">
              <SelectValue>
                {sourceFilter === "all" ? "All sources" : sourceFilter.charAt(0).toUpperCase() + sourceFilter.slice(1)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="orchestrator">Orchestrator</SelectItem>
              <SelectItem value="tool">Tool</SelectItem>
              <SelectItem value="openrouter">OpenRouter</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex-1" />

          <span className="text-xs text-muted-foreground">
            {logs.length} of {total} logs
          </span>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-8 text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
        </div>

      {/* Log list */}
      <div className="rounded-md border border-border flex-1 min-h-0 flex flex-col">
        {loading && logs.length === 0 ? (
          <div className="divide-y divide-border/50">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2">
                <Skeleton className="h-3.5 w-3.5 shrink-0" />
                <Skeleton className="h-3 w-20 shrink-0" />
                <Skeleton className="h-4 w-10 rounded-full shrink-0" />
                <Skeleton className="h-4 w-16 rounded-full shrink-0" />
                <Skeleton className="h-3 w-[40%]" />
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <Empty className="flex-1 justify-center">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListFilter />
              </EmptyMedia>
              <EmptyTitle>
                {isDefaultFilter ? "No logs yet" : "No matching logs"}
              </EmptyTitle>
              <EmptyDescription>
                {isDefaultFilter
                  ? "Logs will appear here as the system runs."
                  : "No logs match the current filters."}
              </EmptyDescription>
            </EmptyHeader>
            {!isDefaultFilter && (
              <EmptyContent className="flex-row justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setLevelFilter("all"); setSourceFilter("all"); }}
                >
                  Clear filters
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <ScrollArea className="h-0 flex-1 [&>div>div]:!block">
            {logs.map((log) => (
              <LogRow key={log.id} log={log} />
            ))}
          </ScrollArea>
        )}
      </div>
      </div>
    </div>
  );
}
