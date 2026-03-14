"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Plus, BookOpen, Shield, Search, ChevronRight } from "lucide-react";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface Guardrail {
  id: string;
  rule: string;
  type: string;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  modelPref: string | null;
  enabled: boolean;
  createdBy: string;
  guardrails: Guardrail[];
}

export function SkillsPageClient({ initialData }: { initialData: Skill[] }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data: skills = [], isLoading: loading } = useQuery<Skill[]>({
    queryKey: ["skills"],
    queryFn: async () => {
      const res = await fetch("/api/skills");
      return res.json();
    },
    initialData,
    staleTime: 0,
  });

  const filtered = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
  );

  async function toggleEnabled(id: string, enabled: boolean) {
    await fetch(`/api/skills/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    queryClient.invalidateQueries({ queryKey: ["skills"] });
    toast.success(enabled ? "Skill enabled" : "Skill disabled");
  }

  function handleCreate() {
    router.push("/skills/new");
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={
          <Button variant="outline" size="sm" onClick={handleCreate}>
            <Plus className="mr-1 h-4 w-4" /> Create Skill
          </Button>
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Skills</BreadcrumbPage>
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
                placeholder="Search skills..."
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
              <span>{filtered.length} skill{filtered.length !== 1 ? "s" : ""}</span>
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
                      <Skeleton className="h-5 w-12 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-[65%]" />
                  </div>
                  <Skeleton className="h-5 w-9 rounded-full shrink-0" />
                  <Skeleton className="h-4 w-4 rounded shrink-0" />
                </div>
              ))}
            </div>
          ) : filtered.length > 0 ? (
            <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
              {filtered.map((skill) => (
                <Link key={skill.id} href={`/skills/${skill.id}`}
                  className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50 transition-colors"
                >
                  <BookOpen className={`h-4 w-4 shrink-0 ${skill.enabled ? "text-muted-foreground" : "text-muted-foreground/40"}`} />
                  <div className={`flex-1 min-w-0 ${!skill.enabled ? "opacity-50" : ""}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {skill.name}
                      </span>
                      {skill.guardrails?.length > 0 && (
                        <Badge variant="outline" className="text-xs shrink-0">
                          <Shield className="mr-1 h-3 w-3" />
                          {skill.guardrails?.length}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {skill.description}
                    </p>
                  </div>
                  <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                    <Switch
                      checked={skill.enabled}
                      onCheckedChange={(enabled) => toggleEnabled(skill.id, enabled)}
                      className="shrink-0"
                    />
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 opacity-40" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex h-[40vh] items-center justify-center text-muted-foreground">
              {skills.length === 0 ? (
                <div className="text-center">
                  <BookOpen className="mx-auto mb-2 h-8 w-8" />
                  <p>No skills yet</p>
                  <p className="mt-1 text-xs">Create skills or let the agent create them automatically</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={handleCreate}>
                    <Plus className="mr-1 h-4 w-4" /> Create Skill
                  </Button>
                </div>
              ) : (
                "No skills match your search."
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
