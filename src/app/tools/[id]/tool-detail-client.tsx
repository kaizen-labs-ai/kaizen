"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, Terminal, Plug, Brain } from "lucide-react";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { CodeBlock } from "@/components/ui/code-block";

interface Tool {
  id: string;
  name: string;
  description: string;
  type: string;
  enabled: boolean;
  memory: string | null;
  config: string;
  inputSchema: string;
  createdBy: string;
}

const TYPE_ICONS: Record<string, typeof Terminal> = {
  system: Terminal,
  mcp: Plug,
};

export function ToolDetailClient({ initialData, id }: { initialData: Tool | null; id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tool, setTool] = useState<Tool | null>(initialData);
  const [memory, setMemory] = useState(initialData?.memory ?? "");
  const [enabled, setEnabled] = useState(initialData?.enabled ?? true);
  const [loading, setLoading] = useState(!initialData);

  const loadTool = useCallback(async () => {
    try {
      const res = await fetch(`/api/tools/${id}`);
      if (!res.ok) {
        router.push("/tools");
        return;
      }
      const data: Tool = await res.json();
      setTool(data);
      setMemory(data.memory ?? "");
      setEnabled(data.enabled);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    if (!initialData) loadTool();
  }, [loadTool]);

  async function saveField(field: string, value: unknown) {
    const res = await fetch(`/api/tools/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (res.ok) {
      toast.success("Saved");
      queryClient.invalidateQueries({ queryKey: ["tools"] });
    } else {
      toast.error("Failed to save");
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem><BreadcrumbLink href="/tools">Tools</BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><Skeleton className="h-4 w-32" /></BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </PageHeader>
        <div className="flex-1 p-4">
          <div className="mx-auto w-full max-w-xl space-y-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!tool) return null;

  const Icon = TYPE_ICONS[tool.type] ?? Terminal;

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/tools">Tools</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{tool.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <ScrollArea className="flex-1 overflow-hidden p-4">
        <div className="mx-auto w-full max-w-xl space-y-6">
          {/* Back link + enabled toggle */}
          <div className="flex items-center justify-between">
            <Link
              href="/tools"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to tools
            </Link>
            <Switch
              checked={enabled}
              onCheckedChange={(val) => {
                setEnabled(val);
                saveField("enabled", val);
              }}
            />
          </div>

          {/* Header */}
          <div className="flex items-start gap-3">
            <Icon className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-semibold">{tool.name}</h1>
                <Badge variant="outline">{tool.type}</Badge>
                {tool.createdBy === "agent" && (
                  <Badge variant="secondary" className="text-xs">agent-created</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{tool.description}</p>
            </div>
          </div>

          {/* Memory section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="memory" className="text-sm font-medium">Tool Memory</Label>
              {memory.trim() && (
                <Badge variant="secondary" className="text-xs">has memory</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Learned quirks, tips, and patterns for this tool. This memory is automatically injected into tool descriptions for the AI agent.
            </p>
            <Textarea
              id="memory"
              placeholder="No tool memory yet. The agent will write here when it learns something about this tool, or you can add notes manually."
              value={memory}
              onChange={(e) => setMemory(e.target.value)}
              onBlur={() => {
                const current = memory.trim() || null;
                const original = tool.memory ?? null;
                if (current !== original) {
                  saveField("memory", current);
                  setTool({ ...tool, memory: current });
                }
              }}
              className="min-h-[120px] text-xs md:text-xs font-mono"
            />
          </div>

          {/* Input Schema (read-only) */}
          {tool.inputSchema && tool.inputSchema !== "{}" && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">Input Schema</Label>
              <CodeBlock language="json">
                {JSON.stringify(JSON.parse(tool.inputSchema), null, 2)}
              </CodeBlock>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
