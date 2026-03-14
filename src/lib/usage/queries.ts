import { prisma } from "@/lib/db/prisma";

export interface UsageSummary {
  totalCost: number;
  totalCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  avgCostPerCall: number;
}

export interface DailyCost {
  date: string;
  cost: number;
  calls: number;
}

export interface ModelCost {
  model: string;
  cost: number;
  calls: number;
  tokens: number;
}

export interface AgentCost {
  agentId: string;
  cost: number;
  calls: number;
  tokens: number;
}

export async function getUsageSummary(since?: Date): Promise<UsageSummary> {
  const where = since ? { createdAt: { gte: since } } : {};
  const agg = await prisma.llmUsage.aggregate({
    where,
    _sum: { cost: true, promptTokens: true, completionTokens: true, totalTokens: true },
    _count: true,
  });
  const totalCost = agg._sum.cost ?? 0;
  const totalCalls = agg._count;
  return {
    totalCost,
    totalCalls,
    totalPromptTokens: agg._sum.promptTokens ?? 0,
    totalCompletionTokens: agg._sum.completionTokens ?? 0,
    totalTokens: agg._sum.totalTokens ?? 0,
    avgCostPerCall: totalCalls > 0 ? totalCost / totalCalls : 0,
  };
}

export async function getDailyCosts(since?: Date): Promise<DailyCost[]> {
  const whereClause = since
    ? `WHERE createdAt >= '${since.toISOString()}'`
    : "";
  const rows = await prisma.$queryRawUnsafe<Array<{ date: string; cost: number; calls: bigint }>>(
    `SELECT date(createdAt) as date, SUM(cost) as cost, COUNT(*) as calls
     FROM LlmUsage ${whereClause}
     GROUP BY date(createdAt)
     ORDER BY date ASC`
  );
  return rows.map(r => ({ date: r.date, cost: Number(r.cost), calls: Number(r.calls) }));
}

export async function getCostByModel(since?: Date): Promise<ModelCost[]> {
  const whereClause = since
    ? `WHERE createdAt >= '${since.toISOString()}'`
    : "";
  const rows = await prisma.$queryRawUnsafe<Array<{ model: string; cost: number; calls: bigint; tokens: bigint }>>(
    `SELECT model, SUM(cost) as cost, COUNT(*) as calls, SUM(totalTokens) as tokens
     FROM LlmUsage ${whereClause}
     GROUP BY model
     ORDER BY cost DESC`
  );
  return rows.map(r => ({ model: r.model, cost: Number(r.cost), calls: Number(r.calls), tokens: Number(r.tokens) }));
}

export async function getCostByAgent(since?: Date): Promise<AgentCost[]> {
  const whereClause = since
    ? `WHERE createdAt >= '${since.toISOString()}'`
    : "";
  const rows = await prisma.$queryRawUnsafe<Array<{ agentId: string; cost: number; calls: bigint; tokens: bigint }>>(
    `SELECT agentId, SUM(cost) as cost, COUNT(*) as calls, SUM(totalTokens) as tokens
     FROM LlmUsage ${whereClause}
     GROUP BY agentId
     ORDER BY cost DESC`
  );
  return rows.map(r => ({ agentId: r.agentId, cost: Number(r.cost), calls: Number(r.calls), tokens: Number(r.tokens) }));
}
