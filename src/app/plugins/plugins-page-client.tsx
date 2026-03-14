"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, ChevronRight, CodeXml } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export interface PluginItem {
  id: string;
  name: string;
  description: string;
  language: string;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
}

const LANGUAGE_COLORS: Record<string, string> = {
  python: "text-yellow-400",
  node: "text-green-400",
  bash: "text-gray-400",
  typescript: "text-blue-400",
  ruby: "text-red-400",
};

export function PluginsPageClient({ initialData }: { initialData: PluginItem[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (searchParams.has("create")) {
      setDialogOpen(true);
      router.replace("/plugins");
    }
  }, [searchParams, router]);
  const [form, setForm] = useState({ name: "", description: "", language: "python" });

  const { data: plugins = [], isLoading: loading } = useQuery<PluginItem[]>({
    queryKey: ["plugins"],
    queryFn: async () => {
      const res = await fetch("/api/plugins");
      if (res.ok) return res.json();
      return [];
    },
    initialData,
    staleTime: 0,
  });

  const filtered = plugins.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()) ||
      p.language.toLowerCase().includes(search.toLowerCase())
  );

  async function handleCreate() {
    if (!form.name || !form.description) {
      toast.error("Name and description are required");
      return;
    }
    const res = await fetch("/api/plugins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Failed to create plugin");
      return;
    }
    const { id } = await res.json();
    toast.success("Plugin created");
    setForm({ name: "", description: "", language: "python" });
    setDialogOpen(false);
    router.push(`/plugins/${id}`);
  }

  async function handleToggle(plugin: PluginItem) {
    await fetch(`/api/plugins/${plugin.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !plugin.enabled }),
    });
    toast.success(plugin.enabled ? "Plugin disabled" : "Plugin enabled");
    queryClient.invalidateQueries({ queryKey: ["plugins"] });
  }

  return (
    <div className="flex h-full flex-col">
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <PageHeader
          actions={
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="mr-1 h-4 w-4" /> Create Plugin
              </Button>
            </DialogTrigger>
          }
        >
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Plugins</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </PageHeader>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Plugin</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. scrape-webpage"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief description of what this plugin does"
              />
            </div>
            <div className="space-y-2">
              <Label>Language</Label>
              <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="python">Python</SelectItem>
                  <SelectItem value="node">Node.js</SelectItem>
                  <SelectItem value="typescript">TypeScript</SelectItem>
                  <SelectItem value="bash">Bash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleCreate} className="w-full">
              Create Plugin
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
                placeholder="Search plugins..."
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
              <span>{filtered.length} plugin{filtered.length !== 1 ? "s" : ""}</span>
            )}
          </div>

          {loading ? (
            <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3">
                  <Skeleton className="h-4 w-4 rounded shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-[35%]" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-[60%]" />
                  </div>
                  <Skeleton className="h-5 w-9 rounded-full shrink-0" />
                  <Skeleton className="h-4 w-4 rounded shrink-0" />
                </div>
              ))}
            </div>
          ) : filtered.length > 0 ? (
            <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
              {filtered.map((plugin) => (
                <div
                  key={plugin.id}
                  className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/plugins/${plugin.id}`)}
                >
                  <CodeXml
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                  />
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {plugin.name}
                      </span>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {plugin.language}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {plugin.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={plugin.enabled}
                      onCheckedChange={() => handleToggle(plugin)}
                    />
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-[40vh] items-center justify-center text-muted-foreground">
              {plugins.length === 0 ? (
                <div className="text-center">
                  <CodeXml className="mx-auto mb-2 h-8 w-8" />
                  <p>No plugins yet</p>
                  <p className="mt-1 text-xs">
                    Create plugins or let the agent create them automatically
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setDialogOpen(true)}>
                    <Plus className="mr-1 h-4 w-4" /> Create Plugin
                  </Button>
                </div>
              ) : (
                "No plugins match your search."
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
