"use client";

import { cn } from "@/lib/utils";
import {
  Wrench,
  AlertCircle,
  Loader2,
  ChevronRight,
  StopCircle,
  ArrowRight,
  FileText,
  Download,
  ExternalLink,
  Bot,
  Route,
  Code,
  Search,
  Database,
  ShieldCheck,
  Play,
  Package,
  Brain,
  ClipboardCheck,
  Scissors,
} from "lucide-react";
import type { ToolInvocation } from "./step-viewer-types";
import { isViewableFile, DurationBadge } from "./step-viewer-types";

// ── Row components ──────────────────────────────────────────────
// Clickable list items rendered in the step viewer.

export function ToolInvocationRow({
  invocation,
  durationMs,
  createdAt,
  onClick,
}: {
  invocation: ToolInvocation;
  durationMs: number | null;
  createdAt?: string;
  onClick: () => void;
}) {
  const callContent = invocation.call.content as Record<string, unknown>;
  const rawName = (callContent.name as string) ?? "tool";
  const friendlyName = rawName
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const hasResult = !!invocation.result;
  let success = true;
  if (hasResult) {
    const resultContent = invocation.result!.content as Record<string, unknown>;
    const resultData = resultContent.result as Record<string, unknown> | undefined;
    success = resultData?.success !== false;
  }

  const failed = hasResult && !success;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 text-xs transition-colors cursor-pointer",
        failed
          ? "text-destructive"
          : "text-muted-foreground"
      )}
    >
      {failed ? (
        <AlertCircle className="h-3 w-3 shrink-0" />
      ) : !hasResult ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      ) : (
        <Wrench className="h-3 w-3 shrink-0" />
      )}
      <span className="font-medium">{friendlyName}</span>
      <span className="flex-1" />
      <DurationBadge ms={durationMs} startedAt={!hasResult ? createdAt : undefined} />
      <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
    </button>
  );
}

export function ErrorRow({ step, onClick }: { step: { content: unknown }; onClick: () => void }) {
  const data = step.content as Record<string, unknown> | null;
  const isCredits = data?.creditsExhausted === true;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-destructive transition-colors cursor-pointer"
    >
      <AlertCircle className="h-3 w-3 shrink-0" />
      <span className="min-w-0 truncate">{isCredits ? "Credits exhausted — add funds at openrouter.ai" : "Error"}</span>
      <span className="flex-1" />
      <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
    </button>
  );
}

export function CancelledRow() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
      <StopCircle className="h-3 w-3 shrink-0" />
      <span className="font-medium">Stopped by user</span>
    </div>
  );
}

export function PhaseChangeRow({ phase, durationMs, onClick }: { phase: string; durationMs: number | null; onClick: () => void }) {
  const label = phase.charAt(0).toUpperCase() + phase.slice(1);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground transition-colors cursor-pointer"
    >
      <ArrowRight className="h-3 w-3 shrink-0" />
      <span className="font-medium">Phase: {label}</span>
      <span className="flex-1" />
      <DurationBadge ms={durationMs} />
      <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
    </button>
  );
}

export function ResultRow({ step, durationMs, onClick }: { step: { content: unknown }; durationMs: number | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-blue-400 transition-colors cursor-pointer"
    >
      <Database className="h-3 w-3 shrink-0" />
      <span className="font-medium">Saved Result</span>
      <span className="flex-1" />
      <DurationBadge ms={durationMs} />
      <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
    </button>
  );
}

export function ArtifactRow({ artifactId, filename }: { artifactId: string; filename: string }) {
  const viewable = isViewableFile(filename);
  return (
    <a
      href={viewable ? `/api/artifacts/${artifactId}/download?inline=1` : `/api/artifacts/${artifactId}/download`}
      {...(viewable ? { target: "_blank", rel: "noopener noreferrer" } : { download: true })}
      className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-green-400 transition-colors cursor-pointer"
    >
      <FileText className="h-3 w-3 shrink-0" />
      <span className="font-medium truncate">{filename}</span>
      <span className="flex-1" />
      {viewable
        ? <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
        : <Download className="h-3 w-3 shrink-0 opacity-60" />}
    </a>
  );
}

export function DeveloperInvocationRow({ invocation, pluginName, toolName, attempt, totalAttempts, stepFailed, stepError, durationMs, createdAt, patchesApplied, hasThinking, onClick }: { invocation: ToolInvocation; pluginName: string; toolName: string; attempt: number; totalAttempts: number; stepFailed?: boolean; stepError?: string; durationMs: number | null; createdAt?: string; patchesApplied?: number; hasThinking?: boolean; onClick: () => void }) {
  const action = patchesApplied && patchesApplied > 0
    ? `patching (${patchesApplied} edit${patchesApplied !== 1 ? "s" : ""})`
    : attempt > 1 ? "improving" : toolName === "edit-plugin" ? "editing" : "creating";
  const hasResult = !!invocation.result;
  let failed = stepFailed === true;
  if (!failed && hasResult) {
    const resultContent = invocation.result!.content as Record<string, unknown>;
    const resultData = resultContent.result as Record<string, unknown> | undefined;
    failed = resultData?.success === false;
  }

  const attemptLabel = totalAttempts > 1 ? ` (${attempt}/${totalAttempts})` : "";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 text-xs transition-colors cursor-pointer",
        failed
          ? "text-destructive"
          : "text-muted-foreground"
      )}
    >
      {!hasResult && !failed && durationMs === null ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      ) : failed ? (
        <AlertCircle className="h-3 w-3 shrink-0" />
      ) : (
        <Code className="h-3 w-3 shrink-0" />
      )}
      <span className="font-medium">Developer</span>
      <span className={cn("min-w-0 truncate", failed ? "text-destructive/60" : "text-muted-foreground/60")}>{action} plugin {pluginName}{attemptLabel}{failed ? (stepError?.includes("credits") ? " — no credits" : " — failed") : ""}</span>
      {hasThinking && (
        <span className="rounded px-1 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-500">
          thinking
        </span>
      )}
      <span className="flex-1" />
      <DurationBadge ms={durationMs} startedAt={!hasResult && !failed && durationMs === null ? createdAt : undefined} />
      <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
    </button>
  );
}

export function ReviewRow({ pluginName, passed, issues, attempt, durationMs, onClick }: { pluginName: string; passed: boolean; issues: string[]; summary: string; attempt: number; durationMs: number | null; onClick: () => void }) {
  const attemptLabel = attempt > 1 ? ` (attempt ${attempt})` : "";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 text-xs transition-colors cursor-pointer",
        passed
          ? "text-green-400"
          : "text-red-400"
      )}
    >
      <ShieldCheck className="h-3 w-3 shrink-0" />
      <span className="font-medium">Reviewer</span>
      <span className={cn("min-w-0 truncate", passed ? "text-green-400/60" : "text-red-400/60")}>
        {passed ? "passed" : `${issues.length} issue${issues.length !== 1 ? "s" : ""}`}{attemptLabel}
      </span>
      <span className="flex-1" />
      <DurationBadge ms={durationMs} />
      <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
    </button>
  );
}

export function PipelineExecutionRow({ pluginName, success, error, outputFiles, durationMs, createdAt, onClick }: { pluginName: string; success: boolean; error?: string; outputFiles: string[]; durationMs: number | null; createdAt?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 text-xs transition-colors cursor-pointer",
        success
          ? "text-muted-foreground"
          : "text-red-400"
      )}
    >
      {durationMs === null && !success && !error ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      ) : (
        <Play className="h-3 w-3 shrink-0" />
      )}
      <span className="font-medium">Execute</span>
      <span className={cn("min-w-0 truncate", success ? "text-muted-foreground/60" : "text-red-400/60")}>
        {success
          ? `${outputFiles.length} file${outputFiles.length !== 1 ? "s" : ""} produced`
          : "failed"}
      </span>
      <span className="flex-1" />
      <DurationBadge ms={durationMs} startedAt={durationMs === null && !success && !error ? createdAt : undefined} />
      <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
    </button>
  );
}

export function PipelineDepsRow({ success, packages, error, durationMs, onClick }: { success: boolean; packages: string[]; error?: string; durationMs: number | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 text-xs transition-colors cursor-pointer",
        success ? "text-muted-foreground" : "text-red-400"
      )}
    >
      <Package className="h-3 w-3 shrink-0" />
      <span className="font-medium">Install Deps</span>
      <span className={cn("min-w-0 truncate", success ? "text-muted-foreground/60" : "text-red-400/60")}>
        {success ? `${packages.length} package${packages.length !== 1 ? "s" : ""}` : "failed"}
      </span>
      <span className="flex-1" />
      <DurationBadge ms={durationMs} />
      <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
    </button>
  );
}

export function ContextPrunedRow({ snapshotsRemoved, charsFreed }: { snapshotsRemoved: number; charsFreed: number }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-amber-400">
      <Scissors className="h-3 w-3 shrink-0" />
      <span className="font-medium">Context pruned</span>
      <span className="min-w-0 truncate text-amber-400/60">
        {snapshotsRemoved} snapshot{snapshotsRemoved !== 1 ? "s" : ""}, ~{Math.round(charsFreed / 1024)}k chars freed
      </span>
    </div>
  );
}

export function PipelineStartRow({ pluginName, action }: { pluginName: string; action: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-[10px] text-muted-foreground/50 uppercase tracking-wider">
      <span>{action} {pluginName}</span>
    </div>
  );
}

export function PipelineSummaryRow({ passed, allFailed, creditsExhausted, totalAttempts, lastIssues, durationMs, onClick }: { passed: boolean | null; allFailed?: boolean; creditsExhausted?: boolean; totalAttempts: number; lastIssues: string[]; durationMs: number | null; onClick: () => void }) {
  const isPassed = passed === true;
  const label = isPassed
    ? "passed"
    : creditsExhausted
      ? "credits exhausted — add funds at openrouter.ai"
      : allFailed
        ? "all attempts errored — no changes applied"
        : `failed after ${totalAttempts} attempt${totalAttempts !== 1 ? "s" : ""}`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 text-xs transition-colors cursor-pointer",
        isPassed ? "text-green-400" : "text-red-400"
      )}
    >
      <ClipboardCheck className="h-3 w-3 shrink-0" />
      <span className="font-medium">Pipeline</span>
      <span className={cn("min-w-0 truncate", isPassed ? "text-green-400/60" : "text-red-400/60")}>
        {label}
      </span>
      <span className="flex-1" />
      <DurationBadge ms={durationMs} />
      <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
    </button>
  );
}

export function AgentHandoffRow({ agent, phase, toolCallCount, hasThinking, durationMs, createdAt, onClick }: { agent: string; phase: string; toolCallCount: number; hasThinking?: boolean; durationMs: number | null; createdAt?: string; onClick: () => void }) {
  const label = agent.charAt(0).toUpperCase() + agent.slice(1);
  const phaseLabel = phase.charAt(0).toUpperCase() + phase.slice(1);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground transition-colors cursor-pointer"
    >
      {durationMs === null ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      ) : (
        <Bot className="h-3 w-3 shrink-0" />
      )}
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground/60">({phaseLabel})</span>
      {hasThinking && (
        <span className="rounded px-1 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-500">
          thinking
        </span>
      )}
      {toolCallCount > 0 && (
        <span className="text-muted-foreground/40 text-[10px]">
          {toolCallCount} tool{toolCallCount !== 1 ? "s" : ""}
        </span>
      )}
      <span className="flex-1" />
      <DurationBadge ms={durationMs} startedAt={durationMs === null ? createdAt : undefined} />
      <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
    </button>
  );
}

export function RoutingRow({ durationMs, onClick }: { durationMs: number | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground transition-colors cursor-pointer"
    >
      <Route className="h-3 w-3 shrink-0" />
      <span className="font-medium">Router</span>
      <span className="text-muted-foreground/60">classifying request</span>
      <span className="flex-1" />
      <DurationBadge ms={durationMs} />
      <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
    </button>
  );
}

export function SearchRow({ matchedSkill, toolsFound, source, durationMs, onClick }: { matchedSkill: { id: string; name: string } | null; toolsFound: string[]; source: string; durationMs: number | null; onClick: () => void }) {
  const toolCount = toolsFound.length;
  const subtext = matchedSkill
    ? `${matchedSkill.name} (${toolCount} tool${toolCount !== 1 ? "s" : ""})`
    : `${toolCount} tool${toolCount !== 1 ? "s" : ""} (${source})`;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground transition-colors cursor-pointer"
    >
      <Search className="h-3 w-3 shrink-0" />
      <span className="font-medium">Search</span>
      <span className="min-w-0 truncate text-muted-foreground/60">{subtext}</span>
      <span className="flex-1" />
      <DurationBadge ms={durationMs} />
      <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
    </button>
  );
}

export function MemoryRetrievalRow({ lineCount, durationMs, onClick }: { lineCount: number; durationMs: number | null; onClick: () => void }) {
  const subtext = lineCount > 0
    ? `${lineCount} line${lineCount !== 1 ? "s" : ""} loaded`
    : "empty";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground transition-colors cursor-pointer"
    >
      <Brain className="h-3 w-3 shrink-0" />
      <span className="font-medium">Memory</span>
      <span className="min-w-0 truncate text-muted-foreground/60">{subtext}</span>
      <span className="flex-1" />
      <DurationBadge ms={durationMs} />
      <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
    </button>
  );
}
