"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  FileText,
  FileCode,
  Database,
  File,
  Download,
  ExternalLink,
  Trash2,
  FolderOpen,
} from "lucide-react";
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

export interface ArtifactItem {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  summary: string | null;
  intermediate: boolean;
  createdAt: string;
  run: {
    id: string;
    sequence: number;
    objective: { id: string; title: string };
  };
}

const CATEGORY_ICONS: Record<string, typeof File> = {
  file: FileText,
  script: FileCode,
  data: Database,
  result: Database,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isViewableInBrowser(mimeType: string): boolean {
  if (mimeType.startsWith("image/")) return true;
  if (mimeType.startsWith("text/")) return true;
  if (mimeType === "application/pdf") return true;
  if (mimeType === "application/json") return true;
  return false;
}

function ArtifactRow({
  artifact,
  onDelete,
}: {
  artifact: ArtifactItem;
  onDelete: (id: string) => void;
}) {
  const Icon = CATEGORY_ICONS[artifact.category] ?? File;
  return (
    <div className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50 transition-colors">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {artifact.filename}
          </span>
          <Badge variant="outline" className="text-xs shrink-0">
            {artifact.category}
          </Badge>
          <span className="text-xs text-muted-foreground shrink-0">
            {formatBytes(artifact.sizeBytes)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {artifact.summary ?? artifact.run.objective.title}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {isViewableInBrowser(artifact.mimeType) && (
          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
            <a href={`/api/artifacts/${artifact.id}/download?inline=1`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
          <a href={`/api/artifacts/${artifact.id}/download`} download>
            <Download className="h-3.5 w-3.5" />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive"
          onClick={() => onDelete(artifact.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ArtifactList({
  items,
  onDelete,
  emptyMessage,
  emptySubMessage,
}: {
  items: ArtifactItem[];
  onDelete: (id: string) => void;
  emptyMessage: string;
  emptySubMessage: string;
}) {
  if (items.length === 0) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <div className="text-center text-muted-foreground">
          <FolderOpen className="mx-auto mb-2 h-8 w-8" />
          <p>{emptyMessage}</p>
          <p className="mt-1 text-xs">{emptySubMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
      {items.map((artifact) => (
        <ArtifactRow
          key={artifact.id}
          artifact={artifact}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

export function OutputsPageClient({ initialData }: { initialData: ArtifactItem[] }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: artifacts = [], isLoading: loading } = useQuery<ArtifactItem[]>({
    queryKey: ["artifacts"],
    queryFn: async () => {
      const res = await fetch("/api/artifacts");
      if (res.ok) return res.json();
      return [];
    },
    initialData,
    staleTime: 0,
  });

  const filtered = artifacts.filter(
    (a) =>
      a.filename.toLowerCase().includes(search.toLowerCase()) ||
      (a.summary ?? "").toLowerCase().includes(search.toLowerCase()) ||
      a.run.objective.title.toLowerCase().includes(search.toLowerCase())
  );

  const deliverables = filtered.filter((a) => !a.intermediate);
  const workingFiles = filtered.filter((a) => a.intermediate);

  async function handleDelete(id: string) {
    await fetch(`/api/artifacts/${id}`, { method: "DELETE" });
    toast.success("Artifact deleted");
    queryClient.invalidateQueries({ queryKey: ["artifacts"] });
  }

  async function handleCleanup() {
    const res = await fetch("/api/artifacts?intermediate=true", {
      method: "DELETE",
    });
    if (res.ok) {
      const data = await res.json();
      toast.success(`Cleaned up ${data.deleted} working file(s)`);
      queryClient.invalidateQueries({ queryKey: ["artifacts"] });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Outputs</BreadcrumbPage>
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
                placeholder="Search outputs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}

          {loading ? (
            <>
            <div className="inline-flex items-center rounded-lg p-[3px] h-9 mb-4 border border-border">
              <div className="flex items-center justify-center rounded-md px-3 h-full">
                <Skeleton className="h-3 w-20" />
              </div>
              <div className="flex items-center justify-center rounded-md px-3 h-full">
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
            <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3">
                  <Skeleton className="h-4 w-4 rounded shrink-0" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-[35%]" />
                      <Skeleton className="h-5 w-12 rounded-full" />
                      <Skeleton className="h-3 w-10" />
                    </div>
                    <Skeleton className="h-3 w-[55%]" />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Skeleton className="h-7 w-7 rounded" />
                    <Skeleton className="h-7 w-7 rounded" />
                  </div>
                </div>
              ))}
            </div>
            </>
          ) : (
          <Tabs defaultValue="deliverables">
            <TabsList>
              <TabsTrigger value="deliverables">
                Deliverables ({deliverables.length})
              </TabsTrigger>
              <TabsTrigger value="temporary">
                Temporary Files ({workingFiles.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="deliverables" className="mt-4">
              <ArtifactList
                items={deliverables}
                onDelete={handleDelete}
                emptyMessage="No deliverables yet"
                emptySubMessage="Final outputs from the agent will appear here"
              />
            </TabsContent>

            <TabsContent value="temporary" className="mt-4">
              {workingFiles.length > 0 && (
                <div className="flex justify-end mb-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive text-xs"
                    onClick={handleCleanup}
                  >
                    <Trash2 className="mr-1 h-3 w-3" /> Clean up all
                  </Button>
                </div>
              )}
              <ArtifactList
                items={workingFiles}
                onDelete={handleDelete}
                emptyMessage="No temporary files"
                emptySubMessage="Intermediate files used during runs will appear here"
              />
            </TabsContent>
          </Tabs>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
