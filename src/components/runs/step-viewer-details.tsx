"use client";

import { cn } from "@/lib/utils";
import {
  Wrench,
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  Loader2,
  ArrowRight,
  Bot,
  ChevronDown,
  Route,
  Search,
  Brain,
} from "lucide-react";
import {
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { CodeBlock } from "@/components/ui/code-block";
import type { ToolInvocation, ToolCallSummary } from "./step-viewer-types";
import { formatDuration } from "./step-viewer-types";
import type { PromptSnapshot } from "./step-parser";

// ── General detail sheet components ─────────────────────────────
// Modal views for non-pipeline step types.

export function InvocationDetail({ invocation }: { invocation: ToolInvocation }) {
  const callContent = invocation.call.content as Record<string, unknown>;
  const rawName = (callContent.name as string) ?? "tool";
  const toolName = rawName
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const args = callContent.arguments as Record<string, unknown> | undefined;

  const hasResult = !!invocation.result;
  let resultContent: Record<string, unknown> | undefined;
  let resultData: Record<string, unknown> | undefined;
  let success = true;

  if (hasResult) {
    resultContent = invocation.result!.content as Record<string, unknown>;
    resultData = resultContent.result as Record<string, unknown> | undefined;
    success = resultData?.success !== false;
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          {toolName}
        </SheetTitle>
        <SheetDescription>
          {hasResult
            ? success
              ? "Tool executed successfully"
              : "Tool execution failed"
            : "Tool is running..."}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-4 px-4 pb-4">
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
            Arguments
          </h4>
          <CodeBlock>{args ? JSON.stringify(args, null, 2) : "{}"}</CodeBlock>
        </div>

        {hasResult && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
              Result
            </h4>
            <div
              className={cn(
                "flex items-center gap-2 text-sm mb-2",
                success ? "text-green-500" : "text-destructive"
              )}
            >
              {success ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <span className="font-medium">
                {success ? "Success" : "Failed"}
              </span>
            </div>
            <CodeBlock>{JSON.stringify(resultData ?? resultContent, null, 2)}</CodeBlock>
          </div>
        )}
      </div>
    </>
  );
}

export function ErrorDetail({ step }: { step: { content: unknown } }) {
  const content = step.content as Record<string, unknown>;
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-4 w-4" />
          Error
        </SheetTitle>
        <SheetDescription>An error occurred during execution</SheetDescription>
      </SheetHeader>
      <div className="px-4 pb-4">
        <CodeBlock>{JSON.stringify(content, null, 2)}</CodeBlock>
      </div>
    </>
  );
}

export function ResultDetail({ step }: { step: { content: unknown } }) {
  const content = step.content as Record<string, unknown>;
  const resultData = content.data as Record<string, unknown> | undefined;
  const summary = content.summary as string | undefined;
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2 text-blue-400">
          <Database className="h-4 w-4" />
          Saved Result
        </SheetTitle>
        {summary && <SheetDescription>{summary}</SheetDescription>}
      </SheetHeader>
      <div className="px-4 pb-4">
        <CodeBlock>
          {resultData
            ? JSON.stringify(resultData, null, 2)
            : JSON.stringify(content, null, 2)}
        </CodeBlock>
      </div>
    </>
  );
}

export function RoutingDetail({ data }: { data: { raw: string; matchedSkillName?: string } }) {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(data.raw);
  } catch {
    // raw text, not JSON
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Route className="h-4 w-4" />
          Router Classification
        </SheetTitle>
        <SheetDescription>
          Raw output from the router model
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-4">
        {parsed ? (
          <>
            {parsed.type && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Type</h4>
                <p className="text-sm">{String(parsed.type)}</p>
              </div>
            )}
            {parsed.complexity && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Complexity</h4>
                <p className="text-sm">{String(parsed.complexity)}</p>
              </div>
            )}
            {parsed.skillId && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Matched Skill</h4>
                {data.matchedSkillName ? (
                  <div className="rounded-md border border-muted-foreground/20 px-3 py-2">
                    <p className="text-sm font-medium">{data.matchedSkillName}</p>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{String(parsed.skillId)}</p>
                  </div>
                ) : (
                  <p className="text-sm font-mono">{String(parsed.skillId)}</p>
                )}
              </div>
            )}
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Raw Response</h4>
              <CodeBlock>{JSON.stringify(parsed, null, 2)}</CodeBlock>
            </div>
          </>
        ) : (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Raw Response</h4>
            <CodeBlock>{data.raw}</CodeBlock>
          </div>
        )}
      </div>
    </>
  );
}

export function SearchDetail({ data }: { data: { matchedSkill: { id: string; name: string } | null; toolsFound: string[]; source: string } }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Search className="h-4 w-4" />
          Search &amp; Tool Discovery
        </SheetTitle>
        <SheetDescription>
          Tools loaded for this execution
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-4">
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Source</h4>
          <p className="text-sm">{data.source === "skill" ? "Matched Skill" : "Global Tools"}</p>
        </div>
        {data.matchedSkill && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Skill</h4>
            <div className="rounded-md border border-muted-foreground/20 px-3 py-2">
              <p className="text-sm font-medium">{data.matchedSkill.name}</p>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{data.matchedSkill.id}</p>
            </div>
          </div>
        )}
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
            Tools Found ({data.toolsFound.length})
          </h4>
          {data.toolsFound.length > 0 ? (
            <div className="rounded-md border border-muted-foreground/20 divide-y divide-muted-foreground/10">
              {data.toolsFound.map((tool, i) => (
                <div key={i} className="px-3 py-1.5 text-xs font-mono truncate">
                  {tool}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No tools found</p>
          )}
        </div>
      </div>
    </>
  );
}

export function MemoryRetrievalDetail({ data }: { data: { content: string; lineCount: number; source: string } }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Brain className="h-4 w-4" />
          Memory Retrieval
        </SheetTitle>
        <SheetDescription>
          User memory loaded into context ({data.lineCount} line{data.lineCount !== 1 ? "s" : ""})
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-4">
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Source</h4>
          <p className="text-sm">{data.source === "user_memory" ? "User Memory" : data.source}</p>
        </div>
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Content</h4>
          {data.content && data.content !== "(empty)" ? (
            <div className="rounded-md border border-muted-foreground/20 bg-muted/30 p-3">
              <pre className="text-xs whitespace-pre-wrap font-mono">{data.content}</pre>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No memory stored yet</p>
          )}
        </div>
      </div>
    </>
  );
}

export function HandoffDetail({ data }: { data: { agent: string; phase: string; model?: string; texts: string[]; thinkingTexts: string[]; toolCalls: ToolCallSummary[]; durationMs: number | null } }) {
  const agentLabel = data.agent.charAt(0).toUpperCase() + data.agent.slice(1);
  const phaseLabel = data.phase.charAt(0).toUpperCase() + data.phase.slice(1);

  const agentDescriptions: Record<string, string> = {
    executor: "Executes the plan using available tools to accomplish the task.",
    planner: "Breaks down complex tasks into actionable steps before execution.",
    reviewer: "Reviews completed work to verify it meets the original objective.",
  };

  const modelDisplay = data.model?.includes("/") ? data.model.split("/").pop() : data.model;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Bot className="h-4 w-4" />
          {agentLabel}
        </SheetTitle>
        <SheetDescription>
          {agentDescriptions[data.agent] ?? "Agent execution"}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-4">
        <div className="flex items-center gap-4">
          {data.durationMs !== null && (
            <div className="flex-1">
              <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Duration</h4>
              <p className="text-sm font-medium">{formatDuration(data.durationMs)}</p>
            </div>
          )}
          <div className="flex-1">
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Phase</h4>
            <p className="text-sm">{phaseLabel}</p>
          </div>
        </div>
        {modelDisplay && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Model</h4>
            <p className="text-sm font-mono">{modelDisplay}</p>
          </div>
        )}
        {data.toolCalls.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
              Tool Calls ({data.toolCalls.length})
            </h4>
            <div className="rounded-md border border-muted-foreground/20 divide-y divide-muted-foreground/10">
              {data.toolCalls.map((tc, i) => (
                <div key={i} className="px-3 py-2 space-y-0.5">
                  <div className="flex items-center gap-2">
                    {tc.success === null ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                    ) : tc.success ? (
                      <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
                    ) : (
                      <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />
                    )}
                    <span className="text-xs font-medium">{tc.name}</span>
                  </div>
                  {tc.errorMsg && (
                    <p className="text-[10px] text-destructive/80 truncate pl-5">{tc.errorMsg}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {data.thinkingTexts.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Thinking</h4>
            <div className="space-y-2">
              {data.thinkingTexts.map((text, i) => (
                <div key={i} className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
                  {text}
                </div>
              ))}
            </div>
          </div>
        )}
        {data.texts.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
              Model Output{data.texts.length > 1 ? ` (${data.texts.length})` : ""}
            </h4>
            <div className="space-y-2">
              {data.texts.map((text, i) => (
                <div key={i} className="rounded-md border border-muted-foreground/20 bg-muted/30 px-3 py-2 text-xs whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                  {text}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}


export function PhaseDetail({ data }: { data: { phase: string } }) {
  const phaseLabel = data.phase.charAt(0).toUpperCase() + data.phase.slice(1);

  const phaseDescriptions: Record<string, string> = {
    routing: "Classifying the request to determine which agent should handle it.",
    planning: "Creating an execution plan for a complex multi-step task.",
    executing: "Running the plan — calling tools and producing results.",
    reviewing: "Verifying the execution results meet the original objective.",
    complete: "All work finished successfully.",
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <ArrowRight className="h-4 w-4" />
          Phase Transition
        </SheetTitle>
        <SheetDescription>
          Execution phase changed
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-4">
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">New Phase</h4>
          <p className="text-sm font-medium">{phaseLabel}</p>
          {phaseDescriptions[data.phase] && (
            <p className="text-xs text-muted-foreground mt-1">{phaseDescriptions[data.phase]}</p>
          )}
        </div>
      </div>
    </>
  );
}

function PromptSection({ label, content }: { label: string; content: string }) {
  return (
    <details className="group">
      <summary className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-muted-foreground uppercase mb-2 select-none">
        <ChevronDown className="h-3 w-3 shrink-0 transition-transform group-open:rotate-0 -rotate-90" />
        {label}
      </summary>
      <div className="rounded-md border border-muted-foreground/20 bg-muted/30 p-3 max-h-[50vh] overflow-y-auto">
        <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed break-words">{content}</pre>
      </div>
    </details>
  );
}

export function TotalDetail({ data }: { data: { totalMs: number | null; promptSnapshot: PromptSnapshot | null } }) {
  const agentLabel = data.promptSnapshot?.agent
    ? data.promptSnapshot.agent.charAt(0).toUpperCase() + data.promptSnapshot.agent.slice(1)
    : null;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Run Summary
        </SheetTitle>
        <SheetDescription>
          {data.totalMs !== null ? `Completed in ${formatDuration(data.totalMs)}` : "Run timing and last prompts"}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-4">
        {data.totalMs !== null && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Total Duration</h4>
            <p className="text-sm font-medium tabular-nums">{formatDuration(data.totalMs)}</p>
          </div>
        )}
        {data.promptSnapshot ? (
          <>
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase mb-1">Last Agent</h4>
              <p className="text-sm font-medium">{agentLabel}</p>
            </div>
            <PromptSection label="System Prompt" content={data.promptSnapshot.systemPrompt} />
            {data.promptSnapshot.userMessages.length > 0 && (
              <PromptSection
                label={`User Messages (${data.promptSnapshot.userMessages.length})`}
                content={data.promptSnapshot.userMessages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n---\n\n")}
              />
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground italic">No prompt data available for this run</p>
        )}
      </div>
    </>
  );
}
