/**
 * Orchestrator: multi-agent run coordinator.
 *
 * Dispatches objectives through phases (triage → discovery → planning → executing → reviewing → complete),
 * routing to the appropriate agent at each step. All domain logic lives in extracted modules:
 *   - schemas.ts          — JSON schemas, types, state objects, parsing utilities
 *   - phase-machine.ts    — phase→agent mapping, tool filtering, router
 *   - message-builder.ts  — message construction, compaction, execution reports
 *   - output-router.ts    — user-facing output emission routing
 *   - pipeline-utils.ts   — code extraction, patching, syntax validation, plugin execution
 *   - code-pipeline.ts    — developer → execute → review loop
 *   - agent-loop.ts       — iterative LLM call + tool execution cycle
 */

import { prisma } from "@/lib/db/prisma";
import {
  type ChatMessage,
  type ToolDefinition,
} from "@/lib/openrouter/client";
import { buildSystemPrompt, clearEnvironmentCache } from "./prompt-builder";
import { getEnabledTools } from "@/lib/tools/registry";
import { parseJsonField } from "@/lib/db/json-helpers";
import { createLog } from "@/lib/logs/logger";
import { ensureAgentConfigs } from "@/lib/agents/defaults";
import { getSetting } from "@/lib/settings/registry";
import { parsePlanProposal } from "./schemas";

// ── Module imports ──────────────────────────────────────────────
import { normalizeSchema } from "./schemas";
import {
  phaseToAgent,
  getToolsForAgent,
  MAX_PHASE_TRANSITIONS,
} from "./phase-machine";
import { OutputRouter } from "./output-router";
import { compactChatHistory, buildExecutionReport } from "./message-builder";
import { callAgent } from "./agent-loop";
import { sanitizeAgentOutput, buildExecutorOutput } from "./pipeline-utils";
import type { RunContactProfile } from "@/lib/extensions/contacts";
import { filterToolsByPermissions } from "@/lib/extensions/contacts";
import { loadChatAndAttachments, buildRecentToolUsage, loadPriorArtifactUrls } from "./orchestrator-setup";
import { generateFallbackResponse, completeRun, handleRunError } from "./orchestrator-finalize";
import { handleTriagePhase, handleImageGenerationRoute, type RouteContext } from "./orchestrator-routes";

// ── Stale run cleanup ────────────────────────────────────────────
// On first call after server start, mark any runs stuck in "running" as
// "failed". These are zombies from a previous process that died. Called
// both lazily (executeRun) and eagerly (active-runs polling endpoint).
let staleRunsCleaned = false;
export async function cleanupStaleRuns(): Promise<void> {
  if (staleRunsCleaned) return;
  staleRunsCleaned = true;
  try {
    const { count } = await prisma.run.updateMany({
      where: { status: "running" },
      data: { status: "failed", endedAt: new Date() },
    });
    if (count > 0) {
      createLog("warn", "coordinator", `Cleaned up ${count} stale run(s) from previous session`).catch(() => {});
    }
  } catch { /* non-critical */ }
}

// ── Types ───────────────────────────────────────────────────────

export interface OrchestratorCallbacks {
  onRunCreated?: (runId: string) => void | Promise<void>;
  onStep: (step: { type: string; content: unknown; toolId?: string; createdAt?: string }) => void | Promise<void>;
  onDelta: (text: string) => void | Promise<void>;
  onComplete: (runId: string) => void | Promise<void>;
  onError: (error: string, runId: string) => void | Promise<void>;
}

export interface AttachmentMeta {
  uploadId: string;
  filename: string;
  mimeType: string;
}

interface RunConfig {
  objectiveId: string;
  chatId?: string;
  model?: string;
  signal?: AbortSignal;
  attachments?: AttachmentMeta[];
  contactProfile?: RunContactProfile;
  skillId?: string;
  pluginId?: string;
}

// ── Main entry point ────────────────────────────────────────────

export async function executeRun(
  config: RunConfig,
  callbacks: OrchestratorCallbacks
) {
  const objective = await prisma.objective.findUniqueOrThrow({
    where: { id: config.objectiveId },
    include: { runs: { orderBy: { sequence: "desc" }, take: 1 } },
  });

  const objConfig = parseJsonField<{
    model?: string;
    maxRuns?: number;
    approvalMode?: string;
    attachments?: AttachmentMeta[];
  }>(objective.config, {});

  // Clean up zombie runs from previous server sessions + load agent configs
  await cleanupStaleRuns();
  await ensureAgentConfigs();
  clearEnvironmentCache(); // Fresh run — don't serve stale tool/skill lists
  const agentConfigs = await prisma.agentConfig.findMany();
  const agentConfigMap = new Map(agentConfigs.map((a) => [a.id, a]));
  const getAgent = (id: string) => agentConfigMap.get(id);

  // Determine next run sequence
  const lastRun = objective.runs[0];
  const sequence = (lastRun?.sequence ?? 0) + 1;
  const isFollowUp = sequence > 1;

  // Create the run record
  const run = await prisma.run.create({
    data: {
      objectiveId: objective.id,
      sequence,
      status: "running",
    },
  });

  // Notify caller immediately so it can save an early message with the runId.
  // This ensures steps are visible on page refresh even if the run crashes later.
  if (callbacks.onRunCreated) {
    try { await callbacks.onRunCreated(run.id); } catch { /* best effort */ }
  }

  let stepSequence = 0;

  async function recordStep(
    type: string,
    content: unknown,
    toolId?: string
  ) {
    const seq = stepSequence + 1;
    const createdAt = new Date().toISOString();
    await prisma.step.create({
      data: {
        runId: run.id,
        sequence: seq,
        type,
        content: JSON.stringify(content),
        toolId,
      },
    });
    stepSequence = seq; // Only increment after successful write
    await callbacks.onStep({ type, content, toolId, createdAt });
  }

  // Log run start
  createLog("info", "coordinator", `Run #${sequence} started`, {
    objectiveId: objective.id,
    runId: run.id,
  }, run.id).catch(() => {});

  try {
    // ── PERSIST / RELOAD ATTACHMENTS ────────────────────────
    // Store attachments on the Objective so follow-up runs (e.g. after interactive
    // planner selection) can reload them even when the client doesn't re-send them.
    if (config.attachments?.length && !objConfig.attachments) {
      const updatedConfig = { ...objConfig, attachments: config.attachments };
      await prisma.objective.update({
        where: { id: objective.id },
        data: { config: JSON.stringify(updatedConfig) },
      });
    } else if (!config.attachments?.length && objConfig.attachments?.length) {
      config.attachments = objConfig.attachments as AttachmentMeta[];
    }

    // ── LOAD CHAT HISTORY + ATTACHMENTS ──────────────────────
    const { chatHistory, uploadParts, buildUserContent } = await loadChatAndAttachments(
      config.chatId,
      isFollowUp,
      run.id,
      config.attachments,
    );

    // ── ROUTING PHASE ──────────────────────────────────────
    const triageResult = await handleTriagePhase({
      objective, uploadParts, chatHistory, getAgent, recordStep,
      config: {
        skillId: config.skillId,
        pluginId: config.pluginId,
        signal: config.signal,
        attachments: config.attachments,
        contactProfile: config.contactProfile,
      },
      objConfig,
      runId: run.id,
      isFollowUp,
      onComplete: callbacks.onComplete,
    });
    if (triageResult.cancelled) return run;

    let currentPhase = triageResult.currentPhase;
    let skillId = triageResult.skillId;
    let complexity = triageResult.complexity;
    let skillContextOnly = triageResult.skillContextOnly;
    let isConversational = triageResult.isConversational;

    // ── LOAD TOOLS (skip for image generation only) ──
    // Always load ALL enabled tools — skill-linked tools are informational hints
    // injected into the prompt, not restrictive filters. This preserves the
    // agent's elastic flow (fallback to alternative tools when needed).
    let dbTools: Awaited<ReturnType<typeof getEnabledTools>> = [];
    if (currentPhase !== "generating_image") {
      dbTools = await getEnabledTools();

      // Record what was searched and found — apply permission filtering so
      // the step only shows tools the contact actually has access to.
      let matchedSkill: { id: string; name: string } | null = null;
      if (skillId) {
        const skill = await prisma.skill.findUnique({ where: { id: skillId }, select: { id: true, name: true } });
        if (skill) matchedSkill = skill;
      }
      let visibleTools = dbTools;
      if (config.contactProfile?.permissions) {
        visibleTools = filterToolsByPermissions(visibleTools, config.contactProfile.permissions);
        if (!config.contactProfile.permissions.pluginAccess) {
          visibleTools = visibleTools.filter((t) => t.type !== "plugin");
        }
      }
      await recordStep("search", {
        matchedSkill,
        toolsFound: visibleTools.map((t) => t.name),
        source: "global",
      });
    }

    const outputRouter = new OutputRouter(callbacks.onDelta);

    // Pre-compute plugin names set (used by callAgent for claim verification)
    const pluginNames = new Set(dbTools.filter((t) => t.type === "plugin").map((t) => t.name));

    // Pre-normalize tool schemas — normalizeSchema is pure and tool schemas
    // don't change during a run. Cache to avoid re-parsing on every transition.
    const normalizedSchemaCache = new Map<string, Record<string, unknown>>();
    for (const t of dbTools) {
      normalizedSchemaCache.set(t.name, normalizeSchema(parseJsonField(t.inputSchema, {})));
    }

    // Build shared context for route handlers
    const routeCtx: RouteContext = {
      objective: { id: objective.id, title: objective.title, description: objective.description },
      runId: run.id,
      chatId: config.chatId,
      model: config.model,
      objConfigModel: objConfig.model,
      chatHistory,
      uploadParts,
      buildUserContent,
      dbTools,
      getAgent,
      outputRouter,
      recordStep,
      signal: config.signal,
      contactProfile: config.contactProfile,
      attachments: config.attachments,
    };

    // ── IMAGE GENERATION SHORT-CIRCUIT ──────────────────────
    if (currentPhase === "generating_image") {
      await handleImageGenerationRoute(routeCtx);
    }

    // ── PHASE DISPATCH LOOP ────────────────────────────────
    // Cache compacted history — chatHistory doesn't change between agent transitions
    // within a single run, so we compact once and reuse.
    let cachedCompactedHistory: ChatMessage[] | null = null;
    // Recent tool usage from prior runs — helps executor pick the right plugin
    // when compaction loses that detail from chat history.
    let cachedRecentToolUsage: string | null | undefined = undefined;

    for (let transition = 0; transition < MAX_PHASE_TRANSITIONS; transition++) {
      // Re-read phase from DB (may have been updated by advance-phase tool)
      const freshObjective = await prisma.objective.findUniqueOrThrow({
        where: { id: objective.id },
        select: { phase: true },
      });
      currentPhase = freshObjective.phase ?? currentPhase;

      if (currentPhase === "complete") break;

      // Auto-skip planning phase to executing. This fires in two cases:
      // 1. Autonomous mode: planner advances discovery → planning, skip redundant dispatch
      // 2. Interactive mode: user responded to plan proposal, objective is in "planning"
      if (currentPhase === "planning") {
        createLog("info", "coordinator", "Auto-skipping planning phase → executing", {
          objectiveId: objective.id,
          runId: run.id,
        }, run.id).catch(() => {});
        await prisma.objective.update({
          where: { id: objective.id },
          data: { phase: "executing" },
        });
        continue;
      }

      // Determine which agent handles this phase
      const agentId = phaseToAgent(currentPhase);
      const agentConfig = getAgent(agentId);
      if (!agentConfig) {
        throw new Error(`Agent config "${agentId}" not found`);
      }

      // Use config.model override or per-objective model, then fall back to agent default
      let model = config.model ?? objConfig.model ?? agentConfig.model;

      // Select media-appropriate model when attachments are present
      if (agentId === "executor" && config.attachments?.length) {
        let hasAudio = false, hasVideo = false, hasImage = false, hasFile = false;
        for (const a of config.attachments) {
          if (a.mimeType.startsWith("audio/")) hasAudio = true;
          else if (a.mimeType.startsWith("video/")) hasVideo = true;
          else if (a.mimeType.startsWith("image/")) hasImage = true;
          else if (a.mimeType === "application/pdf" || a.mimeType.startsWith("application/") || a.mimeType.startsWith("text/")) hasFile = true;
          if (hasAudio && hasVideo && hasImage && hasFile) break;
        }
        if (hasVideo) {
          model = agentConfig.videoModel || model;
        } else if (hasAudio && !hasImage) {
          model = agentConfig.audioModel || model;
        } else if (hasImage) {
          model = agentConfig.imageModel || model;
        } else if (hasFile) {
          model = agentConfig.fileModel || model;
        }
      }

      // Build system prompt and compact chat history in parallel (both async, independent).
      // compactChatHistory is cached after first call; buildSystemPrompt runs every transition.
      const [systemPrompt, compactedHistory] = await Promise.all([
        buildSystemPrompt({
          agentId,
          skillId,
          skillContextOnly,
          phase: currentPhase,
          contactProfile: config.contactProfile,
          objectiveContext: isFollowUp
            ? objective.description
            : undefined,
          systemInstructions: agentConfig.systemPrompt,
        }),
        cachedCompactedHistory
          ? Promise.resolve(cachedCompactedHistory)
          : compactChatHistory(chatHistory, agentId).then((h) => { cachedCompactedHistory = h; return h; }),
      ]);

      // Get filtered tools for this agent
      const deepSkillsSetting = agentId === "executor" ? await getSetting("deep_skills", "false") : "false";
      const agentDbTools = getToolsForAgent(agentId, dbTools, complexity, !!skillId, currentPhase, deepSkillsSetting === "true");
      let toolDefs: ToolDefinition[] = agentDbTools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.memory ? `${t.description}\n\n[Tool memory]: ${t.memory}` : t.description,
          parameters: normalizedSchemaCache.get(t.name) ?? normalizeSchema(parseJsonField(t.inputSchema, {})),
        },
      }));

      // Apply contact permission restrictions (channel contacts may have limited tool access)
      if (config.contactProfile?.permissions) {
        // Filter builtin tools by capability toggles
        toolDefs = filterToolsByPermissions(toolDefs, config.contactProfile.permissions);
        // Filter plugin-type tools when pluginAccess is off
        if (!config.contactProfile.permissions.pluginAccess) {
          toolDefs = toolDefs.filter((td) => !pluginNames.has(td.function.name));
        }
      } else {
        // Main user (no contact profile) — hide channel-only tools
        toolDefs = toolDefs.filter((td) => td.function.name !== "write-whatsapp-contact-memory");
      }
      const objectiveText = objective.description;
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...compactedHistory,
        ...(isFollowUp
          ? []
          : [
              {
                role: "user" as const,
                content: buildUserContent(objectiveText),
              },
            ]),
      ];

      // ── Context enrichment (parallel independent DB queries) ──
      const needsToolUsage: boolean = agentId === "executor" && chatHistory.length > 0 && cachedRecentToolUsage === undefined;
      const needsReport = transition > 0;
      const needsArtifactUrls = agentId === "executor" && !!config.chatId;
      const needsPlanSetting = agentId === "planner" && !config.contactProfile;

      const [toolUsageResult, reportResult, artifactUrlsResult, planSettingResult] = await Promise.all([
        needsToolUsage ? buildRecentToolUsage(config.chatId, run.id) : null,
        needsReport ? buildExecutionReport(run.id) : null,
        needsArtifactUrls ? loadPriorArtifactUrls(config.chatId!).catch(() => null) : null,
        needsPlanSetting ? getSetting("interactive_planning", "false") : null,
      ]) as [string | null, string | null, string[] | null, string | null];

      // Apply results to messages (order: tool usage → execution report → artifact URLs)
      if (needsToolUsage) cachedRecentToolUsage = toolUsageResult;
      if (cachedRecentToolUsage) {
        messages.push({ role: "system", content: cachedRecentToolUsage });
      }
      if (reportResult) {
        messages.push({
          role: "user" as const,
          content: agentId === "reviewer"
            ? `${reportResult}\n\nPlease review the execution results above against the original objective and decide whether to mark complete or send back to executing.`
            : `${reportResult}\n\nContinue working on the objective, building on what was accomplished above.`,
        });
      }
      if (artifactUrlsResult && artifactUrlsResult.length > 0) {
        messages.push({
          role: "system" as const,
          content: `Previously downloaded images in this conversation (DO NOT re-download these URLs — pick different ones):\n${artifactUrlsResult.map((u) => `- ${u}`).join("\n")}`,
        });
      }
      let interactivePlanning = false;
      if (planSettingResult === "true") {
        interactivePlanning = true;
        messages.push({
          role: "system" as const,
          content: "[INTERACTIVE PLANNING MODE]\nPresent soft, user-friendly approach options. Output a plan_proposal JSON and do NOT call advance-phase.",
        });
      }

      // When a skill was forced via slash command, nudge the executor to run it immediately
      if (config.skillId && agentId === "executor" && skillId) {
        messages.push({
          role: "system" as const,
          content: "[SKILL EXECUTION] The user selected this skill to run NOW. Follow the Current Skill instructions step by step using your tools. Do NOT just describe the skill — execute it.",
        });
      }

      // Record agent handoff for UI
      await recordStep("agent_handoff", { agent: agentId, phase: currentPhase, model });

      // Snapshot the prompts sent to this agent (for debugging in the step viewer)
      await recordStep("prompt_snapshot", {
        agent: agentId,
        systemPrompt,
        userMessages: messages.filter((m) => m.role !== "system").map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        })),
      });

      createLog("info", "coordinator", `Dispatching to ${agentId} (${currentPhase})`, {
        objectiveId: objective.id,
        runId: run.id,
        agent: agentId,
        phase: currentPhase,
        model,
      }, run.id).catch(() => {});

      // Conversational messages: strip tools so the executor responds directly
      // without proactive tool calls (e.g. unsolicited bitcoin price lookups)
      const effectiveTools = (agentId === "executor" && isConversational) ? [] : toolDefs;
      const effectiveDbTools = (agentId === "executor" && isConversational) ? [] : agentDbTools;

      // Run the agent
      const result = await callAgent({
        agentId,
        model,
        thinking: agentConfig.thinking,
        timeout: (agentConfig.timeout ?? 120) * 1000,
        messages,
        tools: effectiveTools,
        dbTools: effectiveDbTools,
        pluginNames,
        agentConfigMap,
        maxIterations: Infinity,
        isConversational: agentId === "executor" && isConversational,
        context: { objectiveId: objective.id, runId: run.id, objectiveDescription: objective.description, contactId: config.contactProfile?.contactId },
        contactProfile: config.contactProfile,
        signal: config.signal,
        recordStep,
        onDelta: (text: string) => outputRouter.emit(text, { agentId }),
        onInterimText: async (text: string) => {
          await outputRouter.emitInterim(text, { agentId });
        },
      });

      if (result.cancelled) {
        await prisma.run.update({
          where: { id: run.id },
          data: { status: "cancelled", endedAt: new Date() },
        });
        createLog("info", "coordinator", `Run #${sequence} cancelled by user`, {
          objectiveId: objective.id,
          runId: run.id,
        }, run.id).catch(() => {});
        await callbacks.onComplete(run.id);
        return run;
      }

      // Check if phase changed after agent finished
      const updatedObjective = await prisma.objective.findUniqueOrThrow({
        where: { id: objective.id },
        select: { phase: true },
      });
      let phaseAdvanced = updatedObjective.phase !== currentPhase;

      // Emit output based on agent role:
      // - Executor: always emit (user-facing result with soul personality)
      // - Planner: always emit brief acknowledgment so the chat feels natural,
      //           then auto-advance if it forgot to call advance-phase
      // - Reviewer: never emit (internal review process)
      if (agentId === "executor") {
        // Parallel queries: saved-result summaries + image artifacts (independent)
        const [savedResults, imageArtifacts] = await Promise.all([
          prisma.step.findMany({
            where: { runId: run.id, type: "result" },
            orderBy: { sequence: "asc" },
          }),
          prisma.artifact.findMany({
            where: { runId: run.id, mimeType: { startsWith: "image/" }, category: { not: "upload" } },
            select: { id: true, filename: true },
          }).catch(() => [] as Array<{ id: string; filename: string }>),
        ]);

        const summaries = savedResults.map((r) => {
          try { return JSON.parse(r.content).summary || ""; }
          catch { return ""; }
        }).filter(Boolean);

        let executorOutput = buildExecutorOutput(result.agentRawText, summaries);

        // Strip hallucinated label patterns and <image> tags the model may output
        if (executorOutput) {
          executorOutput = executorOutput
            .replace(/\[Image \d+:.*?\(artifact:[^)]+\)\]\s*<?image>?/g, "")
            .replace(/\[Image \d+:.*?\(artifact:[^)]+\)\]/g, "")
            .replace(/<image>\s*/g, "")
            .trim() || executorOutput;
        }

        // Ensure downloaded image artifacts appear in the final output.
        // Models sometimes use bare filenames or omit image refs entirely.
        {
          if (imageArtifacts.length > 0) {
            // Build all lookup structures in a single pass
            const artifactUrls: Array<{ filename: string; url: string }> = [];
            const fnMap = new Map<string, string>();
            const validArtifactIds = new Set<string>();
            for (const a of imageArtifacts) {
              const url = `/api/artifacts/${a.id}/download?inline=1`;
              artifactUrls.push({ filename: a.filename, url });
              fnMap.set(a.filename, url);
              validArtifactIds.add(a.id);
            }

            // 1. Resolve bare-filename refs AND fix hallucinated artifact URLs.
            // Models sometimes fabricate artifact IDs that don't exist. Detect and fix these
            // by matching the filename in the alt text against known artifacts.
            if (executorOutput) {
              executorOutput = executorOutput.replace(
                /!\[([^\]]*)\]\(([^)]+)\)/g,
                (match, alt, src) => {
                  // Fix hallucinated /api/artifacts/ URLs with invalid IDs
                  const artMatch = (src as string).match(/\/api\/artifacts\/([a-z0-9]+)\/download/);
                  if (artMatch && !validArtifactIds.has(artMatch[1])) {
                    // Try to resolve by filename from alt text
                    const fixedUrl = fnMap.get(alt as string);
                    if (fixedUrl) return `![${alt}](${fixedUrl})`;
                    // No filename match — use the first artifact as fallback
                    if (artifactUrls.length === 1) return `![${alt}](${artifactUrls[0].url})`;
                  }
                  if (src.startsWith("/") || src.startsWith("http://") || src.startsWith("https://")) return match;
                  const url = fnMap.get(src);
                  return url ? `![${alt}](${url})` : match;
                },
              );
            }

            // 2. Append any image artifacts not referenced in the output.
            // Only count refs with VALID artifact URLs — hallucinated refs don't count.
            const text = executorOutput || "";
            const validRefCount = artifactUrls.filter((a) => text.includes(a.url)).length;
            if (validRefCount < imageArtifacts.length) {
              for (const a of artifactUrls) {
                if (!text.includes(a.url)) {
                  executorOutput = (executorOutput || "").trimEnd() + `\n\n![${a.filename}](${a.url})`;
                }
              }
            }
          }
        }

        // Claim verification is now handled as an advance-phase gate inside
        // agent-loop.ts — the agent fixes false claims before the user sees them.

        // Always record executor_summary so the step viewer resets currentAgent
        // (prevents a trailing spinner when the LLM returns empty).
        await recordStep("executor_summary", { text: executorOutput || "", agent: "executor" });

        // Output routing: OutputRouter suppresses executor text when pipeline already passed
        await outputRouter.emit(executorOutput, { agentId: "executor" });

        // Skip top-level reviewer — the code pipeline already has its own
        // Developer → Reviewer loop. Going to a separate reviewer
        // agent just adds latency and confusing extra steps after the final message.
        if (phaseAdvanced) {
          // Single conditional update: skip reviewing → complete (1 query instead of read + update)
          const { count: skippedReview } = await prisma.objective.updateMany({
            where: { id: objective.id, phase: "reviewing" },
            data: { phase: "complete" },
          });
          if (skippedReview > 0) {
            createLog("info", "coordinator", "Executor done — skipping top-level reviewer (code pipeline already reviewed)", {
              objectiveId: objective.id,
              runId: run.id,
            }, run.id).catch(() => {});
          }
        } else {
          // Executor finished without advancing — auto-advance to complete.
          // This happens when the LLM returns empty (no tool calls, no content)
          // after a successful pipeline run.
          createLog("warn", "coordinator", "Executor didn't advance phase — auto-advancing to complete", {
            objectiveId: objective.id,
            runId: run.id,
          }, run.id).catch(() => {});
          await prisma.objective.update({
            where: { id: objective.id },
            data: { phase: "complete", status: "complete" },
          });
          phaseAdvanced = true;
        }
      } else if (agentId === "planner") {
        // Check for interactive plan proposal first
        const planProposal = interactivePlanning
          ? parsePlanProposal(result.agentRawText ?? "")
          : null;

        if (planProposal) {
          // Interactive mode — emit the plan proposal to the user and pause
          const proposalContent = `<!--plan_proposal-->${JSON.stringify(planProposal)}<!--/plan_proposal-->`;
          await recordStep("executor_summary", { text: proposalContent, agent: "planner" });
          // Use "planner_interactive" agentId to bypass OutputRouter suppression
          await outputRouter.emit(proposalContent, { agentId: "planner_interactive" });

          // Keep objective in "planning" phase — don't advance
          await prisma.objective.update({
            where: { id: objective.id },
            data: { phase: "planning" },
          });
          await recordStep("phase", { phase: "planning", durationMs: null });
          createLog("info", "coordinator", "Interactive planner: emitted plan proposal, waiting for user selection", {
            objectiveId: objective.id,
            runId: run.id,
            itemCount: "sections" in planProposal ? planProposal.sections.length : planProposal.options.length,
          }, run.id).catch(() => {});
          // phaseAdvanced stays false → run ends, waiting for user input
        } else {
          // Autonomous mode — planner text is internal, OutputRouter suppresses it.
          // Still record executor_summary so the step viewer resets currentAgent.
          if (result.agentRawText) {
            const plannerText = sanitizeAgentOutput(result.agentRawText);
            await recordStep("executor_summary", { text: plannerText, agent: "planner" });
            await outputRouter.emit(plannerText, { agentId: "planner" });
          }

          if (!phaseAdvanced) {
            const text = (result.agentRawText ?? "").trim();
            const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
            const lastLine = lines[lines.length - 1] ?? "";
            const endsWithQuestion = lastLine.endsWith("?");

            if (!endsWithQuestion) {
              createLog("warn", "coordinator", "Planner didn't advance — auto-advancing to executing", {
                objectiveId: objective.id,
                runId: run.id,
              }, run.id).catch(() => {});
              await prisma.objective.update({
                where: { id: objective.id },
                data: { phase: "executing" },
              });
              phaseAdvanced = true;
            }
          }
        }
      }

      if (!phaseAdvanced) {
        // Agent finished without advancing phase — stop (waiting for user input)
        break;
      }

      // Phase changed — continue dispatch loop
    }

    // Safety net: if no agent produced output, generate a conversational response
    if (!outputRouter.hasEmitted) {
      createLog("warn", "coordinator", "No output emitted — generating fallback response", {
        objectiveId: objective.id,
        runId: run.id,
      }, run.id).catch(() => {});

      const fallbackModel = config.model ?? objConfig.model ?? getAgent("executor")?.model ?? "anthropic/claude-sonnet-4";
      await generateFallbackResponse({
        model: fallbackModel,
        chatHistory,
        objectiveDescription: objective.description,
        timeout: (getAgent("executor")?.timeout ?? 120) * 1000,
        outputRouter,
        recordStep,
        signal: config.signal,
      });
    }

    await completeRun(run.id, sequence, objective.id, stepSequence, callbacks);
  } catch (err) {
    await handleRunError(err, run.id, sequence, objective.id, config.signal, recordStep, callbacks);
  }

  return run;
}
