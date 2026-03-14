"use client";

import { useState } from "react";
import { ChevronRight, Clock } from "lucide-react";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import type { StepData, ToolInvocation, ToolCallSummary, RunStepViewerProps } from "./step-viewer-types";
import { formatDuration } from "./step-viewer-types";
import { parseStepsToEntries, type PromptSnapshot } from "./step-parser";
import {
  ToolInvocationRow,
  ErrorRow,
  CancelledRow,
  PhaseChangeRow,
  ResultRow,
  ArtifactRow,
  DeveloperInvocationRow,

  ReviewRow,
  PipelineExecutionRow,
  PipelineDepsRow,
  PipelineStartRow,
  PipelineSummaryRow,
  AgentHandoffRow,
  RoutingRow,
  SearchRow,
  MemoryRetrievalRow,
  ContextPrunedRow,
} from "./step-viewer-rows";
import {
  InvocationDetail,
  ErrorDetail,
  ResultDetail,
  RoutingDetail,
  SearchDetail,
  MemoryRetrievalDetail,
  HandoffDetail,
  PhaseDetail,
  TotalDetail,
} from "./step-viewer-details";
import {

  PipelineExecutionDetail,
  PipelineDepsDetail,
  PipelineSummaryDetail,
  ReviewDetail,
} from "./step-viewer-pipeline-details";

export type { StepData, RunStepViewerProps };

export function RunStepViewer({ steps, devMode = true, runStatus }: RunStepViewerProps) {
  const [selectedInvocation, setSelectedInvocation] = useState<ToolInvocation | null>(null);
  const [selectedError, setSelectedError] = useState<StepData | null>(null);
  const [selectedResult, setSelectedResult] = useState<StepData | null>(null);
  const [detailSheet, setDetailSheet] = useState<{
    type: "routing" | "search" | "memory_retrieval" | "handoff" | "phase" | "code_review" | "pipeline_execution" | "pipeline_deps" | "pipeline_summary" | "total";
    data: unknown;
  } | null>(null);

  if (steps.length === 0) return null;

  const { visibleEntries, totalMs, lastStepType, lastPromptSnapshot } = parseStepsToEntries(steps, runStatus, devMode);

  if (visibleEntries.length === 0) return null;

  // Count rows that actually render (pipeline_summary can be filtered out)
  const renderedRowCount = visibleEntries.filter(
    (e) => !(e.kind === "pipeline_summary" && e.passed === true && e.totalAttempts <= 1),
  ).length;

  return (
    <>
      <div className="mt-1 space-y-1">
        <div className="rounded-md border border-muted-foreground/20 bg-muted/30 overflow-hidden divide-y divide-muted-foreground/10">
          {(() => {
            let lineNum = 0;
            return visibleEntries.map((entry, i) => {
              let row: React.ReactNode = null;
              let onClick: (() => void) | undefined;
              switch (entry.kind) {
                case "routing":
                  onClick = () => setDetailSheet({ type: "routing", data: entry });
                  row = <RoutingRow key={i} durationMs={entry.durationMs} onClick={onClick} />; break;
                case "search":
                  onClick = () => setDetailSheet({ type: "search", data: entry });
                  row = <SearchRow key={i} matchedSkill={entry.matchedSkill} toolsFound={entry.toolsFound} source={entry.source} durationMs={entry.durationMs} onClick={onClick} />; break;
                case "memory_retrieval":
                  onClick = () => setDetailSheet({ type: "memory_retrieval", data: entry });
                  row = <MemoryRetrievalRow key={i} lineCount={entry.lineCount} durationMs={entry.durationMs} onClick={onClick} />; break;
                case "handoff":
                  onClick = () => setDetailSheet({ type: "handoff", data: entry });
                  row = <AgentHandoffRow key={i} agent={entry.agent} phase={entry.phase} toolCallCount={entry.toolCalls.length} hasThinking={entry.thinkingTexts.length > 0} durationMs={entry.durationMs} createdAt={entry.createdAt} onClick={onClick} />; break;
                case "invocation":
                  onClick = () => setSelectedInvocation(entry.inv);
                  row = <ToolInvocationRow key={i} invocation={entry.inv} durationMs={entry.inv.durationMs} createdAt={entry.createdAt} onClick={onClick} />; break;
                case "result":
                  onClick = () => setSelectedResult(entry.step);
                  row = <ResultRow key={i} step={entry.step} durationMs={entry.durationMs} onClick={onClick} />; break;
                case "artifact":
                  row = <ArtifactRow key={i} artifactId={entry.artifactId} filename={entry.filename} />; break;
                case "error":
                  onClick = () => setSelectedError(entry.step);
                  row = <ErrorRow key={i} step={entry.step} onClick={onClick} />; break;
                case "phase":
                  onClick = () => setDetailSheet({ type: "phase", data: entry });
                  row = <PhaseChangeRow key={i} phase={entry.phase} durationMs={entry.durationMs} onClick={onClick} />; break;
                case "developer_invocation":
                  onClick = () => setSelectedInvocation(entry.inv);
                  row = <DeveloperInvocationRow key={i} invocation={entry.inv} pluginName={entry.pluginName} toolName={entry.toolName} attempt={entry.attempt} totalAttempts={entry.totalAttempts} stepFailed={entry.failed} stepError={entry.error} durationMs={entry.inv.durationMs} createdAt={entry.createdAt} patchesApplied={entry.patchesApplied} hasThinking={entry.hasThinking} onClick={onClick} />; break;
                case "pipeline_summary":
                  if (entry.passed === true && entry.totalAttempts <= 1) return null;
                  onClick = () => setDetailSheet({ type: "pipeline_summary", data: entry });
                  row = <PipelineSummaryRow key={i} passed={entry.passed} allFailed={entry.allFailed} creditsExhausted={entry.creditsExhausted} totalAttempts={entry.totalAttempts} lastIssues={entry.lastIssues} durationMs={entry.durationMs} onClick={onClick} />; break;
                case "pipeline_deps":
                  onClick = () => setDetailSheet({ type: "pipeline_deps", data: entry });
                  row = <PipelineDepsRow key={i} success={entry.success} packages={entry.packages} error={entry.error} durationMs={entry.durationMs} onClick={onClick} />; break;
                case "pipeline_execution":
                  onClick = () => setDetailSheet({ type: "pipeline_execution", data: entry });
                  row = <PipelineExecutionRow key={i} pluginName={entry.pluginName} success={entry.success} error={entry.error} outputFiles={entry.outputFiles} durationMs={entry.durationMs} createdAt={entry.createdAt} onClick={onClick} />; break;
                case "review":
                  onClick = () => setDetailSheet({ type: "code_review", data: entry });
                  row = <ReviewRow key={i} pluginName={entry.pluginName} passed={entry.passed} issues={entry.issues} summary={entry.summary} attempt={entry.attempt} durationMs={entry.durationMs} onClick={onClick} />; break;
                case "pipeline_start":
                  break; // hidden — pipeline steps are self-explanatory
                case "context_pruned":
                  row = <ContextPrunedRow key={i} snapshotsRemoved={entry.snapshotsRemoved} charsFreed={entry.charsFreed} />; break;
                case "cancelled":
                  row = <CancelledRow key={i} />; break;
              }
              if (!row) return null;
              lineNum++;
              return (
                <div key={i} className={`flex hover:bg-muted/50 transition-colors${onClick ? " cursor-pointer" : ""}`} onClick={onClick}>
                  <span className="shrink-0 w-7 text-[10px] tabular-nums text-muted-foreground/40 text-right pr-1.5 py-1.5 select-none pointer-events-none">{lineNum}</span>
                  <div className="flex-1 min-w-0">{row}</div>
                </div>
              );
            });
          })()}
          {devMode && totalMs !== null && (lastStepType === "result" || lastStepType === "executor_summary" || lastStepType === "cancelled" || lastStepType === "error") && (
            <div className="flex hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => setDetailSheet({ type: "total", data: { totalMs, promptSnapshot: lastPromptSnapshot } })}>
              <span className="shrink-0 w-7 text-[10px] tabular-nums text-muted-foreground/40 text-right pr-1.5 py-1.5 select-none pointer-events-none">{renderedRowCount + 1}</span>
              <div className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 shrink-0" />
                <span className="font-medium">Total</span>
                <span className="flex-1" />
                <span className="tabular-nums font-medium">{formatDuration(totalMs)}</span>
                <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
              </div>
            </div>
          )}
        </div>
      </div>

      <Sheet open={!!selectedInvocation} onOpenChange={(open) => !open && setSelectedInvocation(null)}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          {selectedInvocation && <InvocationDetail invocation={selectedInvocation} />}
        </SheetContent>
      </Sheet>

      <Sheet open={!!selectedError} onOpenChange={(open) => !open && setSelectedError(null)}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          {selectedError && <ErrorDetail step={selectedError} />}
        </SheetContent>
      </Sheet>

      <Sheet open={!!selectedResult} onOpenChange={(open) => !open && setSelectedResult(null)}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          {selectedResult && <ResultDetail step={selectedResult} />}
        </SheetContent>
      </Sheet>

      <Sheet open={!!detailSheet} onOpenChange={(open) => !open && setDetailSheet(null)}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          {detailSheet?.type === "routing" && <RoutingDetail data={detailSheet.data as { raw: string; matchedSkillName?: string }} />}
          {detailSheet?.type === "search" && <SearchDetail data={detailSheet.data as { matchedSkill: { id: string; name: string } | null; toolsFound: string[]; source: string }} />}
          {detailSheet?.type === "memory_retrieval" && <MemoryRetrievalDetail data={detailSheet.data as { content: string; lineCount: number; source: string }} />}
          {detailSheet?.type === "handoff" && <HandoffDetail data={detailSheet.data as { agent: string; phase: string; model?: string; texts: string[]; thinkingTexts: string[]; toolCalls: ToolCallSummary[]; durationMs: number | null }} />}
          {detailSheet?.type === "phase" && <PhaseDetail data={detailSheet.data as { phase: string }} />}
          {detailSheet?.type === "code_review" && <ReviewDetail data={detailSheet.data as { pluginName: string; model: string; passed: boolean; issues: string[]; summary: string; attempt: number }} />}
          {detailSheet?.type === "pipeline_execution" && <PipelineExecutionDetail data={detailSheet.data as { pluginName: string; success: boolean; error?: string; outputFiles: string[]; outputArtifacts?: { id: string; filename: string }[]; summary?: string }} />}
          {detailSheet?.type === "pipeline_deps" && <PipelineDepsDetail data={detailSheet.data as { success: boolean; language: string; packages: string[]; error?: string }} />}


          {detailSheet?.type === "pipeline_summary" && <PipelineSummaryDetail data={detailSheet.data as { pluginName: string; passed: boolean | null; totalAttempts: number; maxAttempts: number; reviewSkipped?: boolean; lastIssues: string[]; lastSummary: string }} />}
          {detailSheet?.type === "total" && <TotalDetail data={detailSheet.data as { totalMs: number | null; promptSnapshot: PromptSnapshot | null }} />}
        </SheetContent>
      </Sheet>
    </>
  );
}
