"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Bot, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface AgentItem {
  id: string;
  label: string;
  model: string;
  imageModel: string | null;
  fileModel: string | null;
  audioModel: string | null;
  videoModel: string | null;
  thinking: boolean;
}

export function AgentsPageClient({ initialData }: { initialData: AgentItem[] }) {
  const router = useRouter();

  const { data: agents = [], isLoading: loading } = useQuery<AgentItem[]>({
    queryKey: ["agents"],
    queryFn: async () => {
      const res = await fetch("/api/agents");
      if (res.ok) return res.json();
      return [];
    },
    initialData,
    staleTime: 0,
  });

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3" style={{ visibility: loading ? "hidden" : "visible" }}>
        {agents.length} system agent{agents.length !== 1 ? "s" : ""}
      </p>

      {loading ? (
        <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3">
              <Skeleton className="h-4 w-4 rounded shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-[25%]" />
                  <Skeleton className="h-5 w-32 rounded-full" />
                </div>
              </div>
              <Skeleton className="h-4 w-4 rounded shrink-0" />
            </div>
          ))}
        </div>
      ) : (
      <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
        {agents.map((agent) => (
            <div
              key={agent.id}
              className="flex w-full items-center gap-3 px-3 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => router.push(`/settings/agents/${agent.id}`)}
            >
              <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {agent.label}
                  </span>
                  <Badge variant="outline" className="text-xs shrink-0 font-mono">
                    {agent.model}
                  </Badge>
                  {(() => {
                    const extras = [agent.imageModel, agent.fileModel, agent.audioModel, agent.videoModel].filter(Boolean);
                    return extras.length > 0 ? (
                      <Badge variant="outline" className="text-xs shrink-0">
                        +{extras.length}
                      </Badge>
                    ) : null;
                  })()}
                  {agent.thinking && (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      thinking
                    </Badge>
                  )}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
        ))}
      </div>
      )}
    </div>
  );
}
