/**
 * Structured output schemas, types, and JSON parsing utilities
 * for the orchestrator's LLM interactions.
 */

import type { JsonSchema } from "@/lib/openrouter/client";

// ── Structured output schemas ─────────────────────────────────
// Used with response_format: { type: "json_schema" } to enforce valid JSON.

export const ROUTER_SCHEMA: JsonSchema = {
  name: "router_classification",
  strict: true,
  schema: {
    type: "object",
    properties: {
      complexity: { type: "string", enum: ["simple", "complex", "image_generation"] },
      skillId: { type: ["string", "null"] },
      startPhase: { type: "string", enum: ["executing", "discovery", "generating_image"] },
      skillContextOnly: { type: "boolean" },
      isConversational: { type: "boolean" },
      transcription: { type: ["string", "null"] },
    },
    required: ["complexity", "skillId", "startPhase", "skillContextOnly", "isConversational", "transcription"],
    additionalProperties: false,
  },
};


export const REVIEW_SCHEMA: JsonSchema = {
  name: "review_result",
  strict: true,
  schema: {
    type: "object",
    properties: {
      passed: { type: "boolean" },
      issues: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
    },
    required: ["passed", "issues", "summary"],
    additionalProperties: false,
  },
};

// ── Types ──────────────────────────────────────────────────────

export interface PlanOption {
  label: string;
  description: string;
}

export interface PlanSection {
  dimension: string;
  choices: string[];
}

/** Legacy flat-options format */
export interface PlanProposal {
  type: "plan_proposal";
  summary: string;
  options: PlanOption[];
  research?: string;
}

/** New sectioned-form format */
export interface SectionedPlanProposal {
  type: "plan_proposal";
  summary: string;
  sections: PlanSection[];
  research?: string;
}

export type AnyPlanProposal = PlanProposal | SectionedPlanProposal;

/** Parse a plan proposal from planner output. Accepts both legacy (options) and new (sections) formats. */
export function parsePlanProposal(text: string): AnyPlanProposal | null {
  if (!text) return null;
  const jsonMatch = text.match(/\{[\s\S]*"type"\s*:\s*"plan_proposal"[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.type !== "plan_proposal" || typeof parsed.summary !== "string") return null;

    // New sectioned format
    if (
      Array.isArray(parsed.sections) &&
      parsed.sections.length >= 2 &&
      parsed.sections.every((s: unknown) =>
        typeof s === "object" && s !== null &&
        "dimension" in s && "choices" in s &&
        Array.isArray((s as Record<string, unknown>).choices) &&
        ((s as Record<string, unknown>).choices as unknown[]).length >= 2
      )
    ) {
      return parsed as SectionedPlanProposal;
    }

    // Legacy flat-options format
    if (
      Array.isArray(parsed.options) &&
      parsed.options.length >= 2 &&
      parsed.options.every((o: unknown) =>
        typeof o === "object" && o !== null &&
        "label" in o && "description" in o
      )
    ) {
      return parsed as PlanProposal;
    }
  } catch { /* invalid JSON */ }
  return null;
}

export interface PipelineReviewMeta {
  passed: boolean;
  finalAttempt: number;
  totalAttempts: number;
  lastIssues: string[];
  lastSummary: string;
  reviewSkipped?: boolean;
}

/** Step recording function signature — shared across pipeline modules. */
export type RecordStepFn = (type: string, content: unknown, toolId?: string) => Promise<void>;

// ── State Objects ──────────────────────────────────────────────
// Typed state replaces loose `let` variables for inspectability.

export interface AgentLoopState {
  /** Raw text from the LLM's most recent iteration */
  agentRawText: string | null;
  /** Total tool calls across all iterations */
  totalToolCalls: number;
  /** Consecutive tool failures (resets on success) */
  consecutiveFailures: number;
  /** Consecutive text-only responses nudged to use tools (resets on tool use) */
  nudgeCount: number;
  /** Ring buffer of recent tool call signatures for loop detection */
  recentToolSignatures: string[];
  /** Number of times the tool_loop guardrail has fired */
  loopWarningCount: number;
  /** Sticky: at least one chrome-* browser tool was called */
  browserToolsUsed: boolean;
  /** Total browser tool calls in this run (for periodic progress checks) */
  browserToolCallCount: number;
  /** Number of advance-phase attempts (for browser verification gate) */
  advancePhaseAttempts: number;
  /** Whether interim text has already been emitted to the user this run */
  interimEmitted: boolean;
  /** Total number of substantive text responses generated (for response-count guardrail) */
  responseCount: number;
  /** Tool calls that are NOT advance-phase or other administrative tools */
  substantiveToolCalls: number;
  /** Names of all tools called in this agent loop (for claim verification) */
  toolNamesUsed: Set<string>;
  /** Whether the claim verification gate has already fired (fires at most once) */
  claimGateFired: boolean;
  /** Sticky: pipeline produced validated output — block manual file re-creation */
  pipelineOutputLocked: boolean;
  /** Consecutive search tool calls with thin results (for search-pivot nudge) */
  consecutiveThinSearches: number;
  /** Whether the search-pivot nudge has already fired (fires at most once) */
  searchPivotNudgeFired: boolean;
  /** All URLs seen in tool results (for grounding gate) */
  toolResultUrls: Set<string>;
  /** Whether the grounding gate has already fired (fires at most once) */
  groundingGateFired: boolean;
  /** Sticky: pipeline failed — block code tools (create-plugin/edit-plugin) for remaining iterations */
  pipelineFailed: boolean;
  /** Sticky: zapier_get_configuration_url was called — block create-skill/create-schedule/create-plugin */
  zapierGuidanceGiven: boolean;
  /** Sticky: create-skill/edit-skill was called — nudge executor to smoke-test before advance-phase */
  skillCreatedNotTested: boolean;
  /** Whether the deep skills nudge has already fired this run (prevents re-trigger loop) */
  deepSkillsNudgeFired: boolean;
  /** Cached pipeline_summary count — avoids DB query on every code tool call */
  pipelineCount: number;
  /** Cached planner context from prior steps — avoids DB query on every pipeline invocation */
  cachedPlannerContext: string | undefined;
  /** Whether planner context has been queried yet (avoids repeat DB queries) */
  plannerContextResolved: boolean;
  /** Ordered history of chrome-select-tab pageIds for tab-cycle detection */
  tabSelectHistory: string[];
  /** Whether the tab-cycle guardrail has already fired (fires at most once) */
  tabCycleNudgeFired: boolean;
  /** Tracks consecutive calls to the same tool name (regardless of args) */
  consecutiveSameToolName: string | null;
  consecutiveSameToolCount: number;
  /** Tool name to strip after consecutive-fail-stop fires (hard guardrail) */
  failingToolToStrip: string | null;
}

export function createAgentLoopState(): AgentLoopState {
  return {
    agentRawText: null,
    totalToolCalls: 0,
    consecutiveFailures: 0,
    nudgeCount: 0,
    recentToolSignatures: [],
    loopWarningCount: 0,
    browserToolsUsed: false,
    browserToolCallCount: 0,
    advancePhaseAttempts: 0,
    interimEmitted: false,
    responseCount: 0,
    substantiveToolCalls: 0,
    toolNamesUsed: new Set(),
    claimGateFired: false,
    pipelineOutputLocked: false,
    consecutiveThinSearches: 0,
    searchPivotNudgeFired: false,
    toolResultUrls: new Set(),
    groundingGateFired: false,
    pipelineFailed: false,
    zapierGuidanceGiven: false,
    skillCreatedNotTested: false,
    deepSkillsNudgeFired: false,
    pipelineCount: 0,
    cachedPlannerContext: undefined,
    plannerContextResolved: false,
    tabSelectHistory: [],
    tabCycleNudgeFired: false,
    consecutiveSameToolName: null,
    consecutiveSameToolCount: 0,
    failingToolToStrip: null,
  };
}

export interface PipelineState {
  currentScript: string;
  lastReviewIssues: string[];
  lastReviewSummary: string;
  lastExecutionError: string | null;
  anyDevPassSucceeded: boolean;
  hitCreditsError: boolean;
  lastTestInputs: Record<string, unknown>;
  lastOutputFiles: string[];
  lastReviewResult: { passed: boolean; issues: string[]; summary: string } | null;
  lastAttempt: number;
  bannedAPIs: Set<string>;
  reviewHistory: { attempt: number; issues: string[] }[];
  reviewSkipped: boolean;
}

export function createPipelineState(initialScript: string): PipelineState {
  return {
    currentScript: initialScript,
    lastReviewIssues: [],
    lastReviewSummary: "",
    lastExecutionError: null,
    anyDevPassSucceeded: false,
    hitCreditsError: false,
    lastTestInputs: {},
    lastOutputFiles: [],
    lastReviewResult: null,
    lastAttempt: 0,
    bannedAPIs: new Set(),
    reviewHistory: [],
    reviewSkipped: false,
  };
}

// ── JSON Utilities ─────────────────────────────────────────────

/** Parse JSON from LLM response — tries direct parse first, falls back to regex extraction */
export function parseJsonResponse<T>(text: string): T | null {
  // Direct parse (works when response_format enforces valid JSON)
  try {
    return JSON.parse(text) as T;
  } catch {
    // Fallback: extract first JSON object from text (for models without JSON mode)
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Build response_format for structured JSON output */
export function jsonFormat(schema: JsonSchema) {
  return { type: "json_schema" as const, json_schema: schema };
}

/** Recursively normalize JSON Schema for OpenRouter compatibility.
 *  - Strips fields unsupported by providers (additionalProperties, $schema, etc.)
 *  - Normalises uppercase Gemini types (OBJECT→object, STRING→string)
 *  - Ensures bare type:"object" properties have explicit `properties: {}`
 *    (Gemini rejects OBJECT schemas without a properties map)
 */
export function normalizeSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) return {};
  const obj = { ...(schema as Record<string, unknown>) };
  delete obj.$schema;
  delete obj.title;
  delete obj.default;
  delete obj.examples;

  // Normalise uppercase Gemini types → lowercase JSON Schema types
  if (typeof obj.type === "string") {
    obj.type = obj.type.toLowerCase();
  }

  // Strip additionalProperties — Gemini doesn't support it and it confuses
  // OpenRouter's conversion layer, causing invalid "input" wrapper schemas
  delete obj.additionalProperties;

  // Ensure object types always have an explicit properties map
  if (obj.type === "object" && !obj.properties) {
    obj.properties = {};
  }

  // Guard: if properties is an array (common LLM mistake), convert to object
  if (Array.isArray(obj.properties)) {
    const fixedProps: Record<string, unknown> = {};
    for (const name of obj.properties) {
      if (typeof name === "string") fixedProps[name] = { type: "string" };
    }
    obj.properties = fixedProps;
  }

  if (obj.properties && typeof obj.properties === "object") {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj.properties as Record<string, unknown>)) {
      props[key] = normalizeSchema(val);
    }
    obj.properties = props;
  }

  // Guard: remove required entries that don't exist in properties
  if (Array.isArray(obj.required) && obj.properties && typeof obj.properties === "object") {
    const propKeys = new Set(Object.keys(obj.properties as Record<string, unknown>));
    obj.required = (obj.required as string[]).filter((r) => propKeys.has(r));
    if ((obj.required as string[]).length === 0) delete obj.required;
  }
  if (obj.items && typeof obj.items === "object") {
    obj.items = normalizeSchema(obj.items);
  }
  return obj;
}
