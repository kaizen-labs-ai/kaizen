"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Database, ChevronRight } from "lucide-react";
import Link from "next/link";

export function SkillDatabaseLink({ skillId, skillName }: { skillId: string; skillName: string }) {
  const { data } = useQuery<{ hasDatabase: boolean; totalRows?: number }>({
    queryKey: ["skill-db-tables", skillId],
    queryFn: async () => {
      const res = await fetch(`/api/skills/${skillId}/db/tables`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchOnWindowFocus: false,
  });

  return (
    <>
      <Separator />
      <Link
        href={`/skills/${skillId}/database`}
        className="flex items-center gap-2 py-1 -mx-1 px-1 rounded-md hover:bg-accent/50 transition-colors cursor-pointer group"
      >
        <Database className="h-4 w-4 text-muted-foreground shrink-0" />
        <h3 className="text-sm font-medium">Database</h3>
        <div className="flex-1" />
        {data?.hasDatabase ? (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {data.totalRows} rows
          </Badge>
        ) : (
          <span className="text-[10px] text-muted-foreground">No data</span>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
      </Link>
    </>
  );
}
