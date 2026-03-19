/**
 * Phase-to-agent mapping, tool filtering, router classification,
 * and tool filtering for the orchestrator.
 */

import {
  callOpenRouter,
  type ChatMessage,
  type ContentPart,
  textPart,
} from "@/lib/openrouter/client";
import {
  ROUTER_SCHEMA,
  parseJsonResponse,
  jsonFormat,
} from "./schemas";

// ── Phase → Agent mapping ──────────────────────────────────────

export function phaseToAgent(phase: string): string {
  switch (phase) {
    case "discovery":
    case "planning":
      return "planner";
    case "executing":
      return "executor";
    case "reviewing":
      return "reviewer";
    case "generating_image":
      return "image-generator";
    default:
      return "executor";
  }
}

// ── Tool filtering per agent ────────────────────────────────

// Tools that produce file artifacts — stripped for simple tasks
const ARTIFACT_TOOLS = new Set(["file-write", "save-result"]);
// Plugin creation tools — stripped for simple skill-matched tasks
const PLUGIN_TOOLS = new Set(["create-plugin", "edit-plugin"]);

/** Research tools available to the planner during the discovery phase */
const PLANNER_RESEARCH_TOOLS = new Set([
  "advance-phase", "brave-search", "web-fetch",
  "context7-resolve", "context7-docs",
]);

/** Tools available to the developer agent during the code pipeline */
const DEVELOPER_TOOLS = new Set([
  "web-fetch", "run-snippet", "context7-resolve", "context7-docs",
  "brave-search", "brave-instant",
  "shadcn-list", "shadcn-docs",
]);

export function getToolsForAgent(
  agentId: string,
  allTools: Array<{ id: string; name: string; description: string; inputSchema: string; memory?: string | null }>,
  complexity?: "simple" | "complex" | "image_generation",
  skillMatched?: boolean,
  phase?: string,
  deepSkills?: boolean,
) {
  switch (agentId) {
    case "router":
      return [];
    case "planner":
      // Discovery phase: planner gets research tools to investigate APIs, feasibility, etc.
      if (phase === "discovery") {
        return allTools.filter((t) => PLANNER_RESEARCH_TOOLS.has(t.name));
      }
      return allTools.filter((t) => t.name === "advance-phase");
    case "reviewer":
      return allTools.filter((t) => t.name === "advance-phase");
    case "executor":
      if (complexity === "simple") {
        let filtered = allTools;
        if (skillMatched || deepSkills) {
          // Skill-matched or deep skills: keep artifact tools (skill may need file-write/save-result
          // for execution or smoke-testing). Strip plugin creation tools when running a skill.
          if (skillMatched) {
            filtered = filtered.filter((t) => !PLUGIN_TOOLS.has(t.name));
          }
        } else {
          // No skill, no deep skills: strip artifact tools for simple ad-hoc tasks
          filtered = filtered.filter((t) => !ARTIFACT_TOOLS.has(t.name));
        }
        return filtered;
      }
      return allTools;
    case "developer":
      return allTools.filter((t) => DEVELOPER_TOOLS.has(t.name));
    default:
      return allTools;
  }
}

// ── Router ──────────────────────────────────────────────────

export interface RouterResult {
  complexity: "simple" | "complex" | "image_generation";
  skillId: string | null;
  startPhase: "executing" | "discovery" | "generating_image";
  /** When true, skill is injected as context (what it does) not as mandatory instructions */
  skillContextOnly?: boolean;
  /** When true, the message is purely conversational — executor should respond once without tool loops */
  isConversational?: boolean;
  /** Transcription of audio-only messages (null when text is present or no audio) */
  transcription?: string | null;
}

export async function callRouter(
  objective: { title: string; description: string },
  skills: Array<{ id: string; name: string; description: string }>,
  agentConfig: { model: string; thinking: boolean; timeout: number; systemPrompt: string; audioModel?: string | null },
  recordStep: (type: string, content: unknown) => Promise<void>,
  chatHistory?: ChatMessage[],
  signal?: AbortSignal,
  /** Audio content parts for voice-only messages — router will transcribe */
  audioParts?: ContentPart[],
): Promise<RouterResult> {
  const skillList = skills.length > 0
    ? `\n\nAvailable skills:\n${skills.map((s) => `- ${s.id}: ${s.name} — ${s.description}`).join("\n")}`
    : "";

  let historyContext = "";
  if (chatHistory && chatHistory.length > 0) {
    const recentHistory = chatHistory.slice(-6);
    historyContext = "\n\n## Recent Conversation\n" +
      recentHistory.map((m) => `${m.role}: ${typeof m.content === "string" ? m.content.slice(0, 300) : "[multimodal]"}`).join("\n");
  }

  // When audio parts are present (voice-only message), include them so the
  // router can perceive and transcribe the audio for classification.
  const hasAudio = audioParts && audioParts.length > 0;
  const userContent: string | ContentPart[] = hasAudio
    ? [textPart(`${objective.description}${historyContext}`), ...audioParts]
    : `${objective.description}${historyContext}`;

  const messages: ChatMessage[] = [
    { role: "system", content: agentConfig.systemPrompt + skillList },
    { role: "user", content: userContent },
  ];

  // Use audioModel when processing audio, fall back to default model
  const model = hasAudio
    ? (agentConfig.audioModel || agentConfig.model)
    : agentConfig.model;

  const response = await callOpenRouter({
    model,
    messages,
    stream: false,
    thinking: agentConfig.thinking,
    response_format: jsonFormat(ROUTER_SCHEMA),
    signal,
    timeout: agentConfig.timeout * 1000,
    meta: { agentId: "router" },
  });

  await recordStep("routing", { agent: "router", raw: response.content });

  const parsed = parseJsonResponse<{ complexity?: string; skillId?: string | null; startPhase?: string; skillContextOnly?: boolean; isConversational?: boolean; transcription?: string | null }>(response.content);
  if (parsed) {
    const complexity = parsed.complexity === "complex" ? "complex"
      : parsed.complexity === "image_generation" ? "image_generation"
      : "simple";
    const startPhase = parsed.startPhase === "discovery" ? "discovery"
      : parsed.startPhase === "generating_image" ? "generating_image"
      : "executing";
    const skillId = parsed.skillId && parsed.skillId !== "null" ? parsed.skillId : null;
    const skillContextOnly = parsed.skillContextOnly === true;
    const isConversational = parsed.isConversational === true;
    const transcription = parsed.transcription || null;
    return { complexity, skillId, startPhase, skillContextOnly, isConversational, transcription };
  }
  return { complexity: "simple", skillId: null, startPhase: "executing" };
}

// ── Constants ───────────────────────────────────────────────

export const CODE_TOOL_NAMES = new Set(["create-plugin", "edit-plugin"]);
export const MAX_PIPELINES_PER_RUN = 1;
export const MAX_PHASE_TRANSITIONS = 6;
