"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign,
  Zap,
  Hash,
  TrendingDown,
  BarChart3,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import type { UsageSummary, DailyCost, ModelCost, AgentCost } from "@/lib/usage/queries";

// ── Types ──────────────────────────────────────────────────────

interface UsageData {
  summary: UsageSummary;
  daily: DailyCost[];
  byModel: ModelCost[];
  byAgent: AgentCost[];
}

// ── Formatters ─────────────────────────────────────────────────

function formatCost(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function shortenModel(model: string): string {
  // "openai/gpt-4o" → "gpt-4o", "anthropic/claude-sonnet-4" → "claude-sonnet-4"
  const parts = model.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : model;
}

function humanizeAgent(agentId: string): string {
  const map: Record<string, string> = {
    executor: "Executor",
    planner: "Planner",
    router: "Router",
    developer: "Developer",
    reviewer: "Reviewer",
    titler: "Titler",
    compactor: "Compactor",
    fallback: "Fallback",
    transcribe: "Transcribe",
    "image-generator": "Image Gen",
    unknown: "Unknown",
  };
  return map[agentId] ?? agentId;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Chart colors ───────────────────────────────────────────────

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

// ── Component ──────────────────────────────────────────────────

export function UsagePageClient() {
  const [range, setRange] = useState("30d");

  const { data, isLoading } = useQuery<UsageData>({
    queryKey: ["usage", range],
    queryFn: async () => {
      const res = await fetch(`/api/usage?range=${range}`);
      return res.json();
    },
  });

  const summary = data?.summary;
  const daily = data?.daily ?? [];
  const byModel = data?.byModel ?? [];
  const byAgent = data?.byAgent ?? [];

  // Build chart configs dynamically
  const areaConfig: ChartConfig = {
    cost: { label: "Cost", color: CHART_COLORS[0] },
  };

  const modelConfig: ChartConfig = Object.fromEntries(
    byModel.map((m, i) => [
      m.model,
      { label: shortenModel(m.model), color: CHART_COLORS[i % CHART_COLORS.length] },
    ])
  );

  const agentConfig: ChartConfig = Object.fromEntries(
    byAgent.map((a, i) => [
      a.agentId,
      { label: humanizeAgent(a.agentId), color: CHART_COLORS[i % CHART_COLORS.length] },
    ])
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Usage</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <ScrollArea className="flex-1 overflow-hidden p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Time range selector */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <BarChart3 className="h-4 w-4" />
              <span className="text-sm font-medium">LLM Usage Analytics</span>
            </div>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Summary cards */}
          {isLoading || !summary ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-4 w-20 mb-2" />
                    <Skeleton className="h-8 w-24" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <SummaryCard
                icon={DollarSign}
                label="Total Spend"
                value={formatCost(summary.totalCost)}
              />
              <SummaryCard
                icon={Zap}
                label="Total Calls"
                value={summary.totalCalls.toLocaleString()}
              />
              <SummaryCard
                icon={Hash}
                label="Total Tokens"
                value={formatTokens(summary.totalTokens)}
              />
              <SummaryCard
                icon={TrendingDown}
                label="Avg Cost/Call"
                value={formatCost(summary.avgCostPerCall)}
              />
            </div>
          )}

          {/* Cost over time */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cost Over Time</CardTitle>
              <CardDescription>Daily LLM spending</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[250px] w-full" />
              ) : daily.length === 0 ? (
                <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                  No usage data yet
                </div>
              ) : (
                <ChartContainer config={areaConfig} className="h-[250px] w-full">
                  <AreaChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDate}
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                    />
                    <YAxis
                      tickFormatter={(v: number) => formatCost(v)}
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      width={60}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(label: string) => formatDate(label)}
                          formatter={(value) => formatCost(Number(value))}
                        />
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="cost"
                      stroke={CHART_COLORS[0]}
                      fill="url(#costGradient)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Detailed breakdown table */}
          {!isLoading && byModel.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Model Breakdown</CardTitle>
                <CardDescription>Detailed per-model statistics</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-border divide-y divide-border">
                  <div className="grid grid-cols-5 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
                    <span>Model</span>
                    <span className="text-right">Calls</span>
                    <span className="text-right">Tokens</span>
                    <span className="text-right">Avg/Call</span>
                    <span className="text-right">Cost</span>
                  </div>
                  {byModel.map((m) => (
                    <div key={m.model} className="grid grid-cols-5 gap-2 px-3 py-2 text-sm">
                      <span className="truncate font-medium" title={m.model}>
                        {shortenModel(m.model)}
                      </span>
                      <span className="text-right text-muted-foreground">
                        {m.calls.toLocaleString()}
                      </span>
                      <span className="text-right text-muted-foreground">
                        {formatTokens(m.tokens)}
                      </span>
                      <span className="text-right font-mono text-muted-foreground">
                        {formatCost(m.calls > 0 ? m.cost / m.calls : 0)}
                      </span>
                      <span className="text-right font-mono">
                        {formatCost(m.cost)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Cost by model */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cost by Model</CardTitle>
              <CardDescription>Spending per LLM model</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[250px] w-full" />
              ) : byModel.length === 0 ? (
                <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                  No usage data yet
                </div>
              ) : (
                <ChartContainer config={modelConfig} className="h-[250px] w-full">
                  <BarChart
                    data={byModel.map((m, i) => ({
                      name: shortenModel(m.model),
                      cost: m.cost,
                      fill: CHART_COLORS[i % CHART_COLORS.length],
                    }))}
                    margin={{ top: 4, right: 4, bottom: 20, left: 4 }}
                  >
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                    />
                    <YAxis
                      tickFormatter={(v: number) => formatCost(v)}
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      width={60}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) => formatCost(Number(value))}
                        />
                      }
                    />
                    <Bar dataKey="cost" radius={[4, 4, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Cost by agent */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cost by Agent</CardTitle>
              <CardDescription>Spending per system agent</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-[250px] w-full" />
              ) : byAgent.length === 0 ? (
                <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                  No usage data yet
                </div>
              ) : (
                <ChartContainer config={agentConfig} className="h-[250px] w-full">
                  <BarChart
                    data={byAgent.map((a, i) => ({
                      name: humanizeAgent(a.agentId),
                      cost: a.cost,
                      fill: CHART_COLORS[i % CHART_COLORS.length],
                    }))}
                    margin={{ top: 4, right: 4, bottom: 20, left: 4 }}
                  >
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                    />
                    <YAxis
                      tickFormatter={(v: number) => formatCost(v)}
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      width={60}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) => formatCost(Number(value))}
                        />
                      }
                    />
                    <Bar dataKey="cost" radius={[4, 4, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

        </div>
      </ScrollArea>
    </div>
  );
}

// ── Summary Card ───────────────────────────────────────────────

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">{label}</span>
        </div>
        <div className="text-2xl font-bold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  );
}
