/**
 * Elastic Agent Registry — capability metadata and routing resolution.
 *
 * All system agents are always enabled. This registry defines phase routing,
 * valid transitions, and agent metadata for the orchestrator.
 */

// ── Types ────────────────────────────────────────────────────

export interface AdvancePhaseContext {
  currentPhase: string;
  agentId: string;
  complexity: "simple" | "complex" | "image_generation";
}

export interface ElasticAgentMeta {
  agentId: string;
  /** Orchestrator phases this agent handles (empty for pipeline-internal agents) */
  phases: string[];
  /** Per-phase list of valid advance-phase targets */
  validTransitions: Record<string, string[]>;
  /** Auto-routing: determines next phase when advance-phase called with no args */
  defaultNextPhase?: (ctx: AdvancePhaseContext) => string;
}

// ── Registry Data ────────────────────────────────────────────

export const ELASTIC_AGENTS: Record<string, ElasticAgentMeta> = {
  router: {
    agentId: "router",
    phases: ["triage"],
    validTransitions: {},
  },

  planner: {
    agentId: "planner",
    phases: ["discovery", "planning"],
    validTransitions: {
      discovery: ["planning", "executing"],
      planning: ["executing"],
    },
    defaultNextPhase: () => "executing",
  },

  executor: {
    agentId: "executor",
    phases: ["executing"],
    validTransitions: {
      executing: ["reviewing", "complete"],
    },
    defaultNextPhase: (ctx) => {
      if (ctx.complexity === "complex") {
        return "reviewing";
      }
      return "complete";
    },
  },

  reviewer: {
    agentId: "reviewer",
    phases: ["reviewing"],
    validTransitions: {
      reviewing: ["complete", "executing"], // executing = sendback
    },
    defaultNextPhase: () => "complete",
  },

  developer: {
    agentId: "developer",
    phases: [],
    validTransitions: {},
  },

  titler: {
    agentId: "titler",
    phases: [],
    validTransitions: {},
  },

  compactor: {
    agentId: "compactor",
    phases: [],
    validTransitions: {},
  },

  "image-generator": {
    agentId: "image-generator",
    phases: ["generating_image"],
    validTransitions: {},
  },
};

// ── Resolution Functions ─────────────────────────────────────

/** Get the elastic metadata for an agent */
export function getElasticMeta(agentId: string): ElasticAgentMeta | undefined {
  return ELASTIC_AGENTS[agentId];
}

/**
 * Determine the next phase based on the current agent's routing logic.
 */
export function resolveNextPhase(ctx: AdvancePhaseContext): string {
  const meta = ELASTIC_AGENTS[ctx.agentId];
  if (!meta?.defaultNextPhase) return "complete";
  return meta.defaultNextPhase(ctx);
}

/**
 * Check if a phase transition is valid for the given agent.
 * Returns { valid: true } or { valid: false, reason }.
 */
export function validateTransition(
  agentId: string,
  currentPhase: string,
  targetPhase: string,
): { valid: boolean; reason?: string } {
  const meta = ELASTIC_AGENTS[agentId];
  if (!meta) {
    return { valid: false, reason: `Unknown agent "${agentId}"` };
  }

  const allowed = meta.validTransitions[currentPhase];
  if (!allowed) {
    return {
      valid: false,
      reason: `Agent "${agentId}" cannot transition from "${currentPhase}"`,
    };
  }
  if (!allowed.includes(targetPhase)) {
    return {
      valid: false,
      reason: `Agent "${agentId}" cannot transition from "${currentPhase}" to "${targetPhase}". Allowed: ${allowed.join(", ")}`,
    };
  }

  return { valid: true };
}

