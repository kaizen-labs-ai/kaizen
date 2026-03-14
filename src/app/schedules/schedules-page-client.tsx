"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Clock, Search, CalendarClock, Plus, ChevronRight } from "lucide-react";
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

export interface ScheduleListItem {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  targetType: string;
  destination: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  skill: { id: string; name: string } | null;
}

function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, dom, mon, dow] = parts;

  if (min === "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return "Every minute";
  if (min.startsWith("*/") && hour === "*" && dom === "*") return `Every ${min.slice(2)} minutes`;
  if (min !== "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return `Every hour at :${min.padStart(2, "0")}`;
  if (hour.startsWith("*/") && dom === "*") return `Every ${hour.slice(2)} hours`;
  if (min !== "*" && hour !== "*" && dom === "*" && mon === "*" && dow === "*") return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (min !== "*" && hour !== "*" && dom === "*" && mon === "*" && dow !== "*") {
    const dayNum = parseInt(dow);
    const day = dayNames[dayNum] ?? dow;
    return `${day} at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  if (min !== "*" && hour !== "*" && dom !== "*" && mon !== "*" && dow === "*") {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthName = monthNames[parseInt(mon) - 1] ?? mon;
    return `Yearly on ${monthName} ${dom} at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  if (min !== "*" && hour !== "*" && dom !== "*" && mon === "*" && dow === "*") {
    return `Monthly on day ${dom} at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }

  return cron;
}

function formatNextRun(date: Date): string {
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;

  const datePart = date.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${datePart} ${time}`;
}

export function SchedulesPageClient({ initialData }: { initialData: ScheduleListItem[] }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data: schedules = [], isLoading: loading } = useQuery<ScheduleListItem[]>({
    queryKey: ["schedules"],
    queryFn: async () => {
      const res = await fetch("/api/schedules");
      if (res.ok) return res.json();
      return [];
    },
    initialData,
    staleTime: 0,
    refetchInterval: 30_000,
  });

  const filtered = schedules.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.skill?.name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  async function handleToggle(e: React.MouseEvent, id: string, enabled: boolean) {
    e.stopPropagation();
    await fetch(`/api/schedules/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    queryClient.invalidateQueries({ queryKey: ["schedules"] });
    toast.success(enabled ? "Schedule enabled" : "Schedule disabled");
  }



  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={
          <Button variant="outline" size="sm" onClick={() => router.push("/schedules/new")}>
            <Plus className="mr-1 h-4 w-4" /> New schedule
          </Button>
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Schedules</BreadcrumbPage>
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
                placeholder="Search schedules..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}

          {loading ? (
            <>
              <Skeleton className="h-3 w-24 mb-3" />
              <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-3">
                    <Skeleton className="h-4 w-4 rounded shrink-0" />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-[40%]" />
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </div>
                      <Skeleton className="h-3 w-[50%]" />
                    </div>
                    <Skeleton className="h-5 w-9 rounded-full shrink-0" />
                  </div>
                ))}
              </div>
            </>
          ) : filtered.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                {filtered.length} schedule{filtered.length !== 1 ? "s" : ""}
              </p>
              <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
                {filtered.map((schedule) => {
                  const nextRun = schedule.nextRunAt ? new Date(schedule.nextRunAt) : null;
                  const nextRunLabel = nextRun ? formatNextRun(nextRun) : null;
                  return (
                    <div
                      key={schedule.id}
                      className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => router.push(`/schedules/${schedule.id}`)}
                    >
                      <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {schedule.name}
                          </span>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {cronToHuman(schedule.cron)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5" title={schedule.enabled && nextRun ? nextRun.toLocaleString() : undefined}>
                          {schedule.enabled ? (nextRunLabel ? `Next run: ${nextRunLabel}` : "") : "Disabled"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Switch
                          checked={schedule.enabled}
                          onCheckedChange={(checked) => handleToggle({ stopPropagation: () => {} } as React.MouseEvent, schedule.id, checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-40" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex h-[40vh] items-center justify-center">
              <div className="text-center text-muted-foreground">
                <CalendarClock className="mx-auto mb-2 h-8 w-8" />
                {schedules.length === 0 ? (
                  <>
                    <p>No schedules yet</p>
                    <p className="mt-1 text-xs">
                      Scheduled jobs will appear here when you create a schedule for a skill
                    </p>
                  </>
                ) : (
                  <p>No schedules match your search.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
