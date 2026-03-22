"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Brain, ChevronDown, ChevronRight, RotateCcw, CircleCheck,
  AlertCircle, Clock, Loader2, Undo2, Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Area, AreaChart, XAxis, YAxis, CartesianGrid, ReferenceLine } from "recharts";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface DLConfig {
  enabled: boolean;
  status: string;
  objective: string;
  trainEveryN: number;
  runsSinceLastEpoch: number;
  convergenceThreshold: number;
  maxEpochs: number;
}

interface Epoch {
  id: string;
  epoch: number;
  triggerRunId: string | null;
  status: string;
  hypothesis: string;
  mutation: string;
  fitness: number | null;
  fitnessBreakdown: string;
  cost: number;
  startedAt: string;
  endedAt: string | null;
  snapshot?: { id: string; createdAt: string } | null;
}

interface TrainingData {
  config: DLConfig;
  epochs: Epoch[];
  total: number;
}

export function TrainingPageClient({
  skillId,
  skillName,
}: {
  skillId: string;
  skillName: string;
}) {
  const queryClient = useQueryClient();
  const [expandedEpoch, setExpandedEpoch] = useState<string | null>(null);
  const [epochPage, setEpochPage] = useState(0);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [objectiveDraft, setObjectiveDraft] = useState<string | null>(null);
  const epochsPerPage = 10;

  const { data, isLoading } = useQuery<TrainingData>({
    queryKey: ["skill-training", skillId],
    queryFn: async () => {
      const res = await fetch(`/api/skills/${skillId}/training`);
      if (!res.ok) throw new Error("Failed to load training data");
      return res.json();
    },
    staleTime: 0,
  });

  const { data: epochData, isLoading: epochsLoading } = useQuery<{ epochs: Epoch[]; total: number }>({
    queryKey: ["skill-training-epochs", skillId, epochPage],
    queryFn: async () => {
      const res = await fetch(`/api/skills/${skillId}/training/epochs?limit=${epochsPerPage}&offset=${epochPage * epochsPerPage}`);
      if (!res.ok) throw new Error("Failed to load epochs");
      return res.json();
    },
    staleTime: 0,
  });

  // Fetch ALL epochs for the fitness chart (lightweight — only needs epoch + fitness)
  const { data: allEpochsData } = useQuery<{ epochs: Epoch[]; total: number }>({
    queryKey: ["skill-training-epochs-all", skillId],
    queryFn: async () => {
      const res = await fetch(`/api/skills/${skillId}/training/epochs?limit=1000&offset=0`);
      if (!res.ok) throw new Error("Failed to load epochs");
      return res.json();
    },
    staleTime: 0,
  });

  // SSE: live updates from training pipeline
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;

    function connect() {
      if (closed) return;
      es = new EventSource("/api/events/training");
      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          if (event.skillId !== skillId) return;
          // Invalidate all queries when training state changes
          queryClient.invalidateQueries({ queryKey: ["skill-training", skillId] });
          queryClient.invalidateQueries({ queryKey: ["skill-training-epochs", skillId] });
          queryClient.invalidateQueries({ queryKey: ["skill-training-epochs-all", skillId] });
        } catch { /* ignore */ }
      };
      es.onerror = () => {
        es?.close();
        if (!closed) setTimeout(connect, 3000);
      };
    }

    connect();
    return () => {
      closed = true;
      es?.close();
    };
  }, [skillId, queryClient]);

  const config = data?.config;
  const epochs = epochData?.epochs ?? [];
  const totalEpochs = epochData?.total ?? data?.total ?? 0;
  const totalPages = Math.ceil(totalEpochs / epochsPerPage);

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["skill-training", skillId] });
    queryClient.invalidateQueries({ queryKey: ["skill-training-epochs", skillId] });
    queryClient.invalidateQueries({ queryKey: ["skill-training-epochs-all", skillId] });
  }

  async function updateConfig(updates: Partial<DLConfig>) {
    await fetch(`/api/skills/${skillId}/training`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    invalidateAll();
  }

  async function handleReset() {
    await fetch(`/api/skills/${skillId}/training/reset`, { method: "POST" });
    invalidateAll();
    toast.success("Training state reset");
  }

  async function handleClearEpochs() {
    await fetch(`/api/skills/${skillId}/training/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clearEpochs: true }),
    });
    setEpochPage(0);
    invalidateAll();
    setClearDialogOpen(false);
    toast.success("All training epochs cleared");
  }

  async function handleRollback(epochId: string) {
    const res = await fetch(`/api/skills/${skillId}/training/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ epochId }),
    });
    if (res.ok) {
      invalidateAll();
      toast.success("Rolled back to snapshot");
    } else {
      const err = await res.json();
      toast.error(err.error || "Rollback failed");
    }
  }

  function parseMutation(raw: string): Record<string, unknown> {
    try { return JSON.parse(raw); } catch { return {}; }
  }

  function parseFitness(raw: string): Record<string, number> {
    try { return JSON.parse(raw); } catch { return {}; }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  // Compute fitness chart data points
  // Use ALL epochs for the fitness chart
  const chartEpochs = allEpochsData?.epochs ?? data?.epochs ?? [];
  const fitnessPoints = chartEpochs
    .filter((e) => e.fitness != null)
    .sort((a, b) => a.epoch - b.epoch)
    .map((e) => ({ epoch: e.epoch, fitness: e.fitness! }));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        actions={
          <div className="flex items-center gap-2">
            {config?.status === "optimized" && (
              <Button variant="outline" size="sm" onClick={handleReset}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Reset Training
              </Button>
            )}
          </div>
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/skills">Skills</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href={`/skills/${skillId}`}>{skillName}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Deep Learning</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <ScrollArea className="flex-1 overflow-hidden p-4">
        <div className="mx-auto w-full max-w-2xl space-y-6">

          {/* ── Config Panel ── */}
          {isLoading ? (
            <div className="rounded-md border border-border p-4 space-y-3">
              <Skeleton className="h-5 w-32" />
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </div>
            </div>
          ) : config && (
            <div className="rounded-md border border-border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">Configuration</h3>
                </div>
                <div className="flex items-center gap-3">
                  {config.status === "training" && (
                    <Badge variant="outline" className="border-amber-500/50 text-amber-600 animate-pulse text-xs">
                      Training
                    </Badge>
                  )}
                  {config.status === "optimized" && (
                    <Badge variant="outline" className="border-green-500/50 text-green-600 text-xs">
                      <CircleCheck className="mr-1 h-3 w-3" />
                      Optimized
                    </Badge>
                  )}
                  {config.status === "idle" && config.enabled && (
                    <Badge variant="outline" className="text-xs">Idle</Badge>
                  )}
                  <Switch
                    checked={config.enabled}
                    onCheckedChange={(enabled) => {
                      updateConfig({ enabled });
                      toast.success(enabled ? "Deep Learning enabled" : "Deep Learning disabled");
                    }}
                  />
                </div>
              </div>

              {config.enabled && (
                <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Training Objective</Label>
                  <Textarea
                    placeholder="Describe your training goal. e.g., 'Reduce errors and improve output accuracy' or 'Optimize for speed and efficiency while maintaining quality'"
                    value={objectiveDraft ?? config.objective}
                    onChange={(e) => setObjectiveDraft(e.target.value)}
                    onBlur={() => {
                      if (objectiveDraft !== null && objectiveDraft !== config.objective) {
                        updateConfig({ objective: objectiveDraft });
                        toast.success("Training objective saved");
                      }
                      setObjectiveDraft(null);
                    }}
                    className="text-sm min-h-[60px] resize-y"
                    rows={2}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Tell the trainer what &quot;optimized&quot; means for this skill. This guides every training decision.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Train every N runs</Label>
                    <Input
                      type="number"
                      min={1}
                      value={config.trainEveryN}
                      onChange={(e) => updateConfig({ trainEveryN: parseInt(e.target.value) || 1 })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Convergence threshold</Label>
                    <Input
                      type="number"
                      min={1}
                      value={config.convergenceThreshold}
                      onChange={(e) => updateConfig({ convergenceThreshold: parseInt(e.target.value) || 3 })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Max epochs</Label>
                    <Input
                      type="number"
                      min={1}
                      value={config.maxEpochs}
                      onChange={(e) => updateConfig({ maxEpochs: parseInt(e.target.value) || 50 })}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                </div>
              )}
            </div>
          )}

          {/* ── Fitness Chart ── */}
          {fitnessPoints.length > 1 && (
            <FitnessChart points={fitnessPoints} />
          )}

          {/* ── Epoch Timeline ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">
                Training Epochs {totalEpochs > 0 ? `(${totalEpochs})` : ""}
              </h3>
              {totalEpochs > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-destructive h-7"
                  onClick={() => setClearDialogOpen(true)}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Clear All
                </Button>
              )}
            </div>

            {(isLoading || epochsLoading) && !epochData ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-md" />
                ))}
              </div>
            ) : epochs.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground text-sm rounded-md border border-border">
                <div className="text-center">
                  <Brain className="mx-auto mb-2 h-6 w-6 opacity-50" />
                  <p>No training epochs yet</p>
                  <p className="text-xs mt-1">Enable deep learning and run the skill to start training</p>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
                {epochs.map((epoch) => {
                  const isExpanded = expandedEpoch === epoch.id;
                  const mutation = parseMutation(epoch.mutation);
                  const fitness = parseFitness(epoch.fitnessBreakdown);

                  return (
                    <div key={epoch.id}>
                      {/* Epoch row */}
                      <button
                        className="w-full flex items-center gap-3 px-3 py-3 hover:bg-muted/50 transition-colors text-left"
                        onClick={() => setExpandedEpoch(isExpanded ? null : epoch.id)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}

                        <span className="text-xs font-mono text-muted-foreground w-8 shrink-0">
                          #{epoch.epoch}
                        </span>

                        <EpochStatusBadge status={epoch.status} />

                        <span className="text-sm truncate flex-1">
                          {epoch.hypothesis.slice(0, 100) || "—"}
                        </span>

                        {epoch.fitness != null && (
                          <span className={`text-xs font-mono shrink-0 ${
                            epoch.fitness >= 0.85 ? "text-green-600" :
                            epoch.fitness >= 0.6 ? "text-amber-600" :
                            "text-red-500"
                          }`}>
                            {(epoch.fitness * 100).toFixed(1)}%
                          </span>
                        )}

                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatDate(epoch.startedAt)}
                        </span>
                      </button>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 space-y-3 bg-muted/30">
                          {/* Hypothesis */}
                          <div>
                            <span className="text-xs font-medium text-muted-foreground">Hypothesis</span>
                            <p className="text-sm mt-0.5">{epoch.hypothesis}</p>
                          </div>

                          {/* Mutation */}
                          {typeof mutation.action === "string" && mutation.action !== "no_change" && (
                            <div>
                              <span className="text-xs font-medium text-muted-foreground">Change Applied</span>
                              <pre className="text-xs mt-0.5 p-2 rounded bg-background border border-border overflow-auto max-h-48">
                                {JSON.stringify(mutation, null, 2)}
                              </pre>
                            </div>
                          )}

                          {/* Fitness breakdown */}
                          {Object.keys(fitness).length > 0 && (
                            <div>
                              <span className="text-xs font-medium text-muted-foreground">Fitness Breakdown</span>
                              <div className="grid grid-cols-3 gap-2 mt-1">
                                {Object.entries(fitness).map(([key, val]) => {
                                  const raw = Number(val);
                                  // error_rate is inverted internally (1.0 = no errors)
                                  // Display as actual error % (0% = no errors = good)
                                  const isErrorRate = key === "error_rate";
                                  const display = isErrorRate ? (1 - raw) : raw;
                                  // For error_rate, lower is better (green when low)
                                  const color = isErrorRate
                                    ? (display <= 0.15 ? "text-green-600" : display <= 0.4 ? "text-amber-600" : "text-red-500")
                                    : (raw >= 0.85 ? "text-green-600" : raw >= 0.6 ? "text-amber-600" : "text-red-500");
                                  return (
                                    <div key={key} className="flex items-center justify-between text-xs p-1.5 rounded bg-background border border-border">
                                      <span className="text-muted-foreground">{key.replace(/_/g, " ")}</span>
                                      <span className={`font-mono ${color}`}>
                                        {(display * 100).toFixed(0)}%
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Meta info */}
                          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                            {epoch.cost > 0 && <span>Cost: ${epoch.cost.toFixed(4)}</span>}
                            {epoch.endedAt && epoch.startedAt && (
                              <span>
                                Duration: {((new Date(epoch.endedAt).getTime() - new Date(epoch.startedAt).getTime()) / 1000).toFixed(1)}s
                              </span>
                            )}
                          </div>

                          {/* Rollback button */}
                          {epoch.status === "completed" && epoch.snapshot && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs"
                              onClick={() => handleRollback(epoch.id)}
                            >
                              <Undo2 className="mr-1 h-3 w-3" />
                              Rollback to this point
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-muted-foreground">
                  Page {epochPage + 1} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    disabled={epochPage === 0}
                    onClick={() => setEpochPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    disabled={epochPage >= totalPages - 1}
                    onClick={() => setEpochPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all training epochs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all training epochs, snapshots, and fitness history for this skill. The training status will be reset to idle. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearEpochs}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear All Epochs
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function EpochStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "running":
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/50 text-blue-600 shrink-0">
          <Loader2 className="mr-0.5 h-2.5 w-2.5 animate-spin" />
          Running
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500/50 text-green-600 shrink-0">
          <CircleCheck className="mr-0.5 h-2.5 w-2.5" />
          Done
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-red-500/50 text-red-500 shrink-0">
          <AlertCircle className="mr-0.5 h-2.5 w-2.5" />
          Failed
        </Badge>
      );
    case "rolled_back":
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-500/50 text-orange-600 shrink-0">
          <Undo2 className="mr-0.5 h-2.5 w-2.5" />
          Rolled Back
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
          <Clock className="mr-0.5 h-2.5 w-2.5" />
          {status}
        </Badge>
      );
  }
}

const fitnessChartConfig: ChartConfig = {
  fitness: { label: "Fitness", color: "var(--chart-1)" },
};

function FitnessChart({ points }: { points: Array<{ epoch: number; fitness: number }> }) {
  if (points.length < 2) return null;

  const data = points.map((p) => ({
    epoch: `#${p.epoch}`,
    fitness: Math.round(p.fitness * 1000) / 10, // Convert to percentage with 1 decimal
  }));

  return (
    <div className="rounded-md border border-border p-4 space-y-3">
      <h3 className="text-sm font-medium">Fitness Over Time</h3>
      <div>
        <ChartContainer config={fitnessChartConfig} className="h-[200px] w-full">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="fitnessGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.5} />
                <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="epoch"
              tickLine={false}
              axisLine={false}
              hide
            />
            <YAxis
              tickFormatter={(v: number) => `${v}%`}
              tickLine={false}
              axisLine={false}
              fontSize={12}
              width={45}
              domain={["dataMin - 5", "dataMax + 5"]}
            />
            <ReferenceLine
              y={85}
              stroke="hsl(var(--chart-2))"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{ value: "85%", position: "right", fill: "hsl(var(--chart-2))", fontSize: 10, opacity: 0.7 }}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => `${value}%`}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="fitness"
              stroke="var(--chart-1)"
              fill="url(#fitnessGradient)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </div>
  );
}
