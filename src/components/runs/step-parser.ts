import type { StepData, ParsedEntry, ToolInvocation, ToolCallSummary } from "./step-viewer-types";
import { getDurationBetween } from "./step-viewer-types";

// ── Step parser ─────────────────────────────────────────────────
// Pure function that transforms raw steps into chronological display entries.
// No React imports — this is a pure data transformation.

export interface PromptSnapshot {
  agent: string;
  systemPrompt: string;
  userMessages: { role: string; content: string }[];
}

export interface ParseResult {
  entries: ParsedEntry[];
  visibleEntries: ParsedEntry[];
  totalMs: number | null;
  lastStepType: string | undefined;
  lastPromptSnapshot: PromptSnapshot | null;
}

export function parseStepsToEntries(
  steps: StepData[],
  runStatus?: string,
  devMode?: boolean,
): ParseResult {
  if (steps.length === 0) {
    return { entries: [], visibleEntries: [], totalMs: null, lastStepType: undefined, lastPromptSnapshot: null };
  }

  // Duration helpers
  const durationTo = (i: number) => getDurationBetween(steps[i]?.createdAt, steps[i + 1]?.createdAt);
  const durationFrom = (i: number) => i > 0 ? getDurationBetween(steps[i - 1]?.createdAt, steps[i]?.createdAt) : null;

  const chronoEntries: ParsedEntry[] = [];
  let hasResults = false;
  let hasArtifacts = false;

  let currentAgent: string | null = null;
  let currentPhase: string | null = null;
  let currentAgentModel: string | undefined = undefined;
  let currentHandoffEntry: Extract<ParsedEntry, { kind: "handoff" }> | null = null;

  const LLM_CALL_THRESHOLD_MS = 100;

  let lastPromptSnapshot: PromptSnapshot | null = null;

  let currentPipelineCall: StepData | null = null;
  let currentPipelineToolName = "";
  let currentPipelinePluginName = "";
  let lastPipelineDevEntryIdx = -1;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.type === "agent_handoff") {
      const content = step.content as Record<string, unknown>;
      currentAgent = content.agent as string;
      currentPhase = content.phase as string;
      currentAgentModel = (content.model as string) ?? undefined;
      currentHandoffEntry = null;
      if (i === steps.length - 1) {
        const entry: Extract<ParsedEntry, { kind: "handoff" }> = {
          kind: "handoff",
          agent: currentAgent,
          phase: currentPhase,
          model: currentAgentModel,
          texts: [],
          thinkingTexts: [],
          toolCalls: [],
          durationMs: null,
          createdAt: step.createdAt,
        };
        chronoEntries.push(entry);
        currentHandoffEntry = entry;
      }
    } else if (step.type === "prompt_snapshot") {
      const content = step.content as Record<string, unknown>;
      lastPromptSnapshot = {
        agent: (content.agent as string) ?? "",
        systemPrompt: (content.systemPrompt as string) ?? "",
        userMessages: Array.isArray(content.userMessages)
          ? (content.userMessages as { role: string; content: string }[])
          : [],
      };
    } else if (step.type === "reasoning") {
      const content = step.content as Record<string, unknown>;
      const text = (content.text as string) ?? "";
      const thinking = (content.thinking as string) ?? "";
      if (currentAgent && (text.trim() || thinking.trim())) {
        // Merge consecutive reasoning steps for the same agent into one entry.
        // Multiple reasoning steps happen when the agent goes through nudge cycles
        // (text-only → nudge → text+tools). No need to show each iteration separately.
        if (currentHandoffEntry && currentHandoffEntry.agent === currentAgent && currentHandoffEntry.toolCalls.length === 0) {
          if (text.trim()) currentHandoffEntry.texts.push(text);
          if (thinking.trim()) currentHandoffEntry.thinkingTexts.push(thinking);
          const dur = durationFrom(i);
          if (dur !== null) currentHandoffEntry.durationMs = dur;
        } else {
          const entry: Extract<ParsedEntry, { kind: "handoff" }> = {
            kind: "handoff",
            agent: currentAgent,
            phase: currentPhase ?? "",
            model: currentAgentModel,
            texts: text.trim() ? [text] : [],
            thinkingTexts: thinking.trim() ? [thinking] : [],
            toolCalls: [],
            durationMs: durationFrom(i),
            createdAt: steps[i - 1]?.createdAt,
          };
          chronoEntries.push(entry);
          currentHandoffEntry = entry;
        }
      }
    } else if (step.type === "executor_summary") {
      const summaryContent = step.content as Record<string, unknown>;
      const summaryText = (summaryContent.text as string) ?? "";

      // If no handoff entry was created for this agent (e.g. conversational
      // flows with no reasoning/tool_call between handoff and summary),
      // create one now so the LLM inference time is visible in the UI.
      if (currentAgent && !currentHandoffEntry) {
        const entry: Extract<ParsedEntry, { kind: "handoff" }> = {
          kind: "handoff",
          agent: currentAgent,
          phase: currentPhase ?? "",
          model: currentAgentModel,
          texts: summaryText.trim() ? [summaryText] : [],
          thinkingTexts: [],
          toolCalls: [],
          durationMs: durationFrom(i),
          createdAt: steps[i - 1]?.createdAt,
        };
        chronoEntries.push(entry);
      } else if (currentHandoffEntry && summaryText.trim()) {
        // Attach the response text to the existing handoff entry — but skip
        // if it duplicates an already-captured text (reasoning often matches
        // executor_summary verbatim)
        if (!currentHandoffEntry.texts.includes(summaryText)) {
          currentHandoffEntry.texts.push(summaryText);
        }
      }
      currentAgent = null;
      currentPhase = null;
      currentAgentModel = undefined;
      currentHandoffEntry = null;
    } else if (step.type === "routing") {
      const content = step.content as Record<string, unknown>;
      // Look ahead for the search step to get the matched skill name
      let matchedSkillName: string | undefined;
      for (let j = i + 1; j < steps.length && j <= i + 3; j++) {
        if (steps[j].type === "search") {
          const searchContent = steps[j].content as Record<string, unknown>;
          const ms = searchContent.matchedSkill as { name: string } | null;
          if (ms?.name) matchedSkillName = ms.name;
          break;
        }
      }
      chronoEntries.push({ kind: "routing", raw: content.raw as string, matchedSkillName, durationMs: durationTo(i) });
    } else if (step.type === "search") {
      const content = step.content as Record<string, unknown>;
      chronoEntries.push({
        kind: "search",
        matchedSkill: content.matchedSkill as { id: string; name: string } | null,
        toolsFound: (content.toolsFound as string[]) ?? [],
        source: (content.source as string) ?? "global",
        durationMs: durationTo(i),
      });
    } else if (step.type === "memory_retrieval") {
      const content = step.content as Record<string, unknown>;
      chronoEntries.push({
        kind: "memory_retrieval",
        content: (content.content as string) ?? "",
        lineCount: (content.lineCount as number) ?? 0,
        source: (content.source as string) ?? "user_memory",
        durationMs: durationTo(i),
      });
    } else if (step.type === "tool_call") {
      const callContent = step.content as Record<string, unknown>;
      const toolName = callContent.name as string;

      if (currentAgent && !currentPipelineCall) {
        const prevType = steps[i - 1]?.type;
        const isAfterReasoning = prevType === "reasoning";
        const gap = durationFrom(i);
        const isNewLlmCall = !isAfterReasoning &&
          (prevType === "agent_handoff" || prevType === "prompt_snapshot" || (gap !== null && gap >= LLM_CALL_THRESHOLD_MS));

        if (isNewLlmCall) {
          const entry: Extract<ParsedEntry, { kind: "handoff" }> = {
            kind: "handoff",
            agent: currentAgent,
            phase: currentPhase ?? "",
            model: currentAgentModel,
            texts: [],
            thinkingTexts: [],
            toolCalls: [],
            durationMs: gap,
            createdAt: steps[i - 1]?.createdAt,
          };
          chronoEntries.push(entry);
          currentHandoffEntry = entry;
        }
      }

      if (toolName === "advance-phase") {
        const args = callContent.arguments as Record<string, unknown> | undefined;
        const hasResult = i + 1 < steps.length && steps[i + 1].type === "tool_result";
        let phaseSucceeded = true;
        if (hasResult) {
          const resultContent = steps[i + 1].content as Record<string, unknown>;
          const resultData = resultContent.result as Record<string, unknown> | undefined;
          phaseSucceeded = resultData?.success !== false;
        }
        const phaseDur = hasResult
          ? getDurationBetween(step.createdAt, steps[i + 1].createdAt)
          : null;
        if (args?.phase && phaseSucceeded) {
          chronoEntries.push({ kind: "phase", phase: args.phase as string, durationMs: phaseDur });
        }
        // Capture advance-phase summary into the handoff entry so the
        // planner's reasoning is visible when clicking the handoff row
        const summary = args?.summary as string | undefined;
        if (summary?.trim() && currentHandoffEntry) {
          currentHandoffEntry.texts.push(summary);
        }
        currentAgent = null;
        currentPhase = null;
        if (hasResult) i++;
        continue;
      }

      const isCodeTool = toolName === "create-plugin" || toolName === "edit-plugin";

      if (isCodeTool) {
        const args = callContent.arguments as Record<string, unknown> | undefined;
        currentPipelineCall = step;
        currentPipelineToolName = toolName;
        currentPipelinePluginName = (args?.name as string) ?? "plugin";
        lastPipelineDevEntryIdx = -1;
        chronoEntries.push({
          kind: "pipeline_start",
          pluginName: currentPipelinePluginName,
          action: toolName === "edit-plugin" ? "Editing" : "Creating",
        });
      } else if (currentPipelineCall) {
        const nextIdx = i + 1;
        if (nextIdx < steps.length && steps[nextIdx].type === "tool_result") {
          i = nextIdx;
        }
      } else {
        const inv: ToolInvocation & { durationMs: number | null } = { call: step, durationMs: null };
        const nextIdx = i + 1;
        if (nextIdx < steps.length && steps[nextIdx].type === "tool_result") {
          inv.result = steps[nextIdx];
          inv.durationMs = getDurationBetween(step.createdAt, steps[nextIdx].createdAt);
          i = nextIdx;
        }

        if (toolName === "file-write" && inv.result) {
          const resultContent = inv.result.content as Record<string, unknown>;
          const resultData = resultContent.result as Record<string, unknown> | undefined;
          if (resultData?.output) {
            const output = resultData.output as Record<string, unknown>;
            if (output.artifactId) {
              chronoEntries.push({
                kind: "artifact",
                artifactId: output.artifactId as string,
                filename: output.filename as string,
              });
              hasArtifacts = true;
              if (currentHandoffEntry) {
                currentHandoffEntry.toolCalls.push({ name: toolName, success: true });
              }
              continue;
            }
          }
        }

        chronoEntries.push({ kind: "invocation", inv, toolName, createdAt: step.createdAt });

        if (currentHandoffEntry) {
          let success: boolean | null = null;
          let errorMsg: string | undefined;
          if (inv.result) {
            const rc = inv.result.content as Record<string, unknown>;
            const rd = rc.result as Record<string, unknown> | undefined;
            success = rd?.success !== false;
            if (!success) errorMsg = (rd?.error as string) ?? undefined;
          }
          currentHandoffEntry.toolCalls.push({ name: toolName, success, errorMsg });
        }
      }

    } else if (step.type === "pipeline_summary") {
      const data = step.content as Record<string, unknown>;
      chronoEntries.push({
        kind: "pipeline_summary",
        pluginName: (data.pluginName as string) ?? currentPipelinePluginName,
        passed: data.passed === true ? true : data.passed === false ? false : null,
        allFailed: data.allFailed === true,
        creditsExhausted: data.creditsExhausted === true,
        totalAttempts: (data.totalAttempts as number) ?? 0,
        maxAttempts: (data.maxAttempts as number) ?? 6,
        lastIssues: Array.isArray(data.lastIssues) ? (data.lastIssues as string[]) : [],
        lastSummary: (data.lastSummary as string) ?? "",
        durationMs: durationFrom(i),
      });

    } else if (step.type === "pipeline_deps") {
      const data = step.content as Record<string, unknown>;
      chronoEntries.push({
        kind: "pipeline_deps",
        success: data.success === true,
        language: (data.language as string) ?? "",
        packages: Array.isArray(data.packages) ? (data.packages as string[]) : [],
        error: (data.error as string) ?? undefined,
        durationMs: durationFrom(i),
      });

    } else if (step.type === "context_pruned") {
      const data = step.content as Record<string, unknown>;
      chronoEntries.push({
        kind: "context_pruned",
        snapshotsRemoved: (data.snapshotsRemoved as number) ?? 0,
        charsFreed: (data.charsFreed as number) ?? 0,
        durationMs: durationFrom(i),
      });

    } else if (step.type === "developer_enhancement") {
      const data = step.content as Record<string, unknown>;
      const attempt = (data.attempt as number) ?? 1;
      const totalAttempts = (data.totalAttempts as number) ?? attempt;
      const devToolName = (data.toolName as string) || currentPipelineToolName || "create-plugin";
      chronoEntries.push({
        kind: "developer_invocation",
        inv: { call: currentPipelineCall ?? step, durationMs: durationFrom(i) },
        toolName: devToolName,
        pluginName: (data.pluginName as string) ?? currentPipelinePluginName,
        model: (data.model as string) ?? "",
        attempt,
        totalAttempts,
        failed: data.failed === true ? true : undefined,
        error: (data.error as string) ?? undefined,
        createdAt: steps[i - 1]?.createdAt,
        patchMode: data.patchMode === true ? true : undefined,
        patchesApplied: (data.patchesApplied as number) ?? undefined,
        patchesFailed: (data.patchesFailed as number) ?? undefined,
        hasThinking: data.thinking === true ? true : undefined,
      });
      lastPipelineDevEntryIdx = chronoEntries.length - 1;

    } else if (step.type === "pipeline_execution") {
      const data = step.content as Record<string, unknown>;
      chronoEntries.push({
        kind: "pipeline_execution",
        pluginName: (data.pluginName as string) ?? currentPipelinePluginName,
        success: data.success === true,
        error: (data.error as string) ?? undefined,
        outputFiles: Array.isArray(data.outputFiles) ? (data.outputFiles as string[]) : [],
        outputArtifacts: Array.isArray(data.outputArtifacts) ? (data.outputArtifacts as { id: string; filename: string }[]) : undefined,
        summary: (data.summary as string) ?? undefined,
        durationMs: durationFrom(i),
        createdAt: steps[i - 1]?.createdAt,
      });

    } else if (step.type === "review") {
      const data = step.content as Record<string, unknown>;
      chronoEntries.push({
        kind: "review",
        pluginName: (data.pluginName as string) ?? currentPipelinePluginName,
        model: (data.model as string) ?? "",
        passed: data.passed === true,
        issues: Array.isArray(data.issues) ? (data.issues as string[]) : [],
        summary: (data.summary as string) ?? "",
        attempt: (data.attempt as number) ?? 1,
        durationMs: durationFrom(i),
      });

    } else if (step.type === "tool_result") {
      if (currentPipelineCall && lastPipelineDevEntryIdx >= 0) {
        const lastDev = chronoEntries[lastPipelineDevEntryIdx];
        if (lastDev.kind === "developer_invocation") {
          lastDev.inv.result = step;
          lastDev.inv.durationMs = getDurationBetween(currentPipelineCall.createdAt, step.createdAt);
        }
      }
      currentPipelineCall = null;
      currentPipelineToolName = "";
      currentPipelinePluginName = "";
      lastPipelineDevEntryIdx = -1;

    } else if (step.type === "error") {
      chronoEntries.push({ kind: "error", step });
    } else if (step.type === "result") {
      hasResults = true;
      chronoEntries.push({ kind: "result", step, durationMs: durationFrom(i) });
    } else if (step.type === "agent_skipped") {
      // Legacy — no-op

    } else if (step.type === "cancelled") {
      chronoEntries.push({ kind: "cancelled" });
    }
  }

  // ── Trailing activity spinner ──────────────────────────────────
  const lastStepType = steps[steps.length - 1]?.type;
  const runStillActive = runStatus
    ? runStatus === "running"
    : lastStepType !== "cancelled" && lastStepType !== "error";

  if (currentAgent && runStillActive) {
    if (currentPipelineCall) {
      const lastEntry = chronoEntries[chronoEntries.length - 1];
      const lk = lastEntry?.kind;
      const lastCreatedAt = steps[steps.length - 1]?.createdAt;

      if (lk === "review" && !(lastEntry as { passed: boolean }).passed) {
        chronoEntries.push({
          kind: "developer_invocation",
          inv: { call: currentPipelineCall, durationMs: null },
          toolName: currentPipelineToolName || "create-plugin",
          pluginName: currentPipelinePluginName,
          model: "",
          attempt: ((lastEntry as { attempt: number }).attempt || 1) + 1,
          totalAttempts: 3,
          createdAt: lastCreatedAt,
        });
      } else if (lk === "pipeline_execution" && !(lastEntry as { success: boolean }).success) {
        chronoEntries.push({
          kind: "developer_invocation",
          inv: { call: currentPipelineCall, durationMs: null },
          toolName: currentPipelineToolName || "create-plugin",
          pluginName: currentPipelinePluginName,
          model: "",
          attempt: 2,
          totalAttempts: 3,
          createdAt: lastCreatedAt,
        });
      } else if (lk !== "developer_invocation"
        && lk !== "pipeline_execution" && lk !== "pipeline_deps" && lk !== "review" && lk !== "pipeline_summary") {
        const pipelineStartIdx = chronoEntries.findLastIndex((e) => e.kind === "pipeline_start");

        if (chronoEntries.some((e) => e.kind === "pipeline_start")) {
          const hasDevStep = pipelineStartIdx >= 0
            ? chronoEntries.slice(pipelineStartIdx).some((e) => e.kind === "developer_invocation")
            : false;

          if (!hasDevStep) {
            chronoEntries.push({
              kind: "developer_invocation",
              inv: { call: currentPipelineCall, durationMs: null },
              toolName: currentPipelineToolName || "create-plugin",
              pluginName: currentPipelinePluginName,
              model: "",
              attempt: 1,
              totalAttempts: 3,
              createdAt: lastCreatedAt,
            });
          }
        }
      }
    } else {
      const lastEntry = chronoEntries[chronoEntries.length - 1];
      const alreadyHasSpinner = lastEntry?.kind === "handoff"
        && (lastEntry as { durationMs: number | null }).durationMs === null;
      if (!alreadyHasSpinner) {
        chronoEntries.push({
          kind: "handoff",
          agent: currentAgent,
          phase: currentPhase ?? "",
          model: currentAgentModel,
          texts: [],
          thinkingTexts: [],
          toolCalls: [],
          durationMs: null,
          createdAt: steps[steps.length - 1]?.createdAt,
        });
      }
    }
  }

  // Visibility filtering
  const hiddenTools = new Set<string>();
  if (hasResults) hiddenTools.add("save-result");
  if (hasArtifacts) hiddenTools.add("file-write");

  const visibleEntries = chronoEntries.filter((e) => {
    if (e.kind === "invocation" && hiddenTools.has(e.toolName)) return false;
    if (e.kind === "artifact") return false;
    if (!devMode && e.kind !== "cancelled") return false;
    return true;
  });

  const totalMs = getDurationBetween(steps[0]?.createdAt, steps[steps.length - 1]?.createdAt);

  return { entries: chronoEntries, visibleEntries, totalMs, lastStepType, lastPromptSnapshot };
}
