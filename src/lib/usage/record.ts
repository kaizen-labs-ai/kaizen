import { prisma } from "@/lib/db/prisma";

// ── Model pricing cache ─────────────────────────────────────────
// Cached for 1 hour. Maps model id → { prompt, completion } per-token prices.

interface ModelPricing {
  prompt: number;
  completion: number;
}

let pricingCache: Map<string, ModelPricing> | null = null;
let pricingFetchedAt = 0;
const PRICING_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getModelPricing(): Promise<Map<string, ModelPricing>> {
  if (pricingCache && Date.now() - pricingFetchedAt < PRICING_TTL_MS) {
    return pricingCache;
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return pricingCache ?? new Map();

    const json = await res.json() as { data?: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> };
    const map = new Map<string, ModelPricing>();

    for (const model of json.data ?? []) {
      if (model.pricing) {
        map.set(model.id, {
          prompt: parseFloat(model.pricing.prompt ?? "0") || 0,
          completion: parseFloat(model.pricing.completion ?? "0") || 0,
        });
      }
    }

    pricingCache = map;
    pricingFetchedAt = Date.now();
    return map;
  } catch {
    return pricingCache ?? new Map();
  }
}

function calculateCost(
  model: string,
  usage: { prompt_tokens: number; completion_tokens: number },
  pricing: Map<string, ModelPricing>,
): number {
  const p = pricing.get(model);
  if (!p) return 0;
  return usage.prompt_tokens * p.prompt + usage.completion_tokens * p.completion;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Record LLM usage metrics. Fire-and-forget — never breaks the LLM pipeline.
 */
export async function recordLlmUsage(params: {
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  cost?: number;
  durationMs?: number;
  agentId: string;
  runId?: string;
}): Promise<void> {
  if (!params.usage) return;

  try {
    // Use provided cost if available, otherwise calculate from model pricing
    let cost = params.cost ?? 0;
    if (!cost) {
      const pricing = await getModelPricing();
      cost = calculateCost(params.model, params.usage, pricing);
    }

    await prisma.llmUsage.create({
      data: {
        runId: params.runId ?? null,
        agentId: params.agentId,
        model: params.model,
        promptTokens: params.usage.prompt_tokens,
        completionTokens: params.usage.completion_tokens,
        totalTokens: params.usage.prompt_tokens + params.usage.completion_tokens,
        cost,
        durationMs: params.durationMs ?? 0,
      },
    });
  } catch {
    // Never let usage tracking break the LLM pipeline
  }
}
