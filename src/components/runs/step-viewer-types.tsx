"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

// ── Shared types ────────────────────────────────────────────────

export interface StepData {
  type: string;
  content: unknown;
  toolId?: string;
  createdAt?: string;
}

export interface ToolInvocation {
  call: StepData;
  result?: StepData;
}

/** File extensions that browsers can render inline */
const VIEWABLE_EXTENSIONS = new Set([
  ".html", ".htm", ".txt", ".csv", ".json", ".xml", ".svg",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
  ".pdf",
]);

export function isViewableFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return VIEWABLE_EXTENSIONS.has(ext);
}

// ── Chronological entry types ───────────────────────────────────

export type ToolCallSummary = {
  name: string;
  success: boolean | null; // null = still running
  errorMsg?: string;
};

export type ParsedEntry =
  | { kind: "routing"; raw: string; matchedSkillName?: string; durationMs: number | null }
  | { kind: "search"; matchedSkill: { id: string; name: string } | null; toolsFound: string[]; source: string; durationMs: number | null }
  | { kind: "memory_retrieval"; content: string; lineCount: number; source: string; durationMs: number | null }
  | { kind: "handoff"; agent: string; phase: string; model?: string; texts: string[]; thinkingTexts: string[]; toolCalls: ToolCallSummary[]; durationMs: number | null; createdAt?: string }
  | { kind: "invocation"; inv: ToolInvocation & { durationMs: number | null }; toolName: string; createdAt?: string }
  | { kind: "result"; step: StepData; durationMs: number | null }
  | { kind: "artifact"; artifactId: string; filename: string; mimeType?: string }
  | { kind: "error"; step: StepData }
  | { kind: "phase"; phase: string; durationMs: number | null }
  | { kind: "developer_invocation"; inv: ToolInvocation & { durationMs: number | null }; toolName: string; pluginName: string; model: string; attempt: number; totalAttempts: number; failed?: boolean; error?: string; createdAt?: string; patchMode?: boolean; patchesApplied?: number; patchesFailed?: number; hasThinking?: boolean }
  | { kind: "review"; pluginName: string; model: string; passed: boolean; issues: string[]; summary: string; attempt: number; reviewedOutput?: string; outputFiles?: string[]; durationMs: number | null }
  | { kind: "pipeline_execution"; pluginName: string; success: boolean; error?: string; outputFiles: string[]; outputArtifacts?: { id: string; filename: string }[]; summary?: string; durationMs: number | null; createdAt?: string }
  | { kind: "pipeline_deps"; success: boolean; language: string; packages: string[]; error?: string; durationMs: number | null }

  | { kind: "pipeline_start"; pluginName: string; action: string }
  | { kind: "pipeline_summary"; pluginName: string; passed: boolean | null; allFailed?: boolean; creditsExhausted?: boolean; totalAttempts: number; maxAttempts: number; lastIssues: string[]; lastSummary: string; durationMs: number | null }
  | { kind: "context_pruned"; snapshotsRemoved: number; charsFreed: number; durationMs: number | null }
  | { kind: "cancelled" };

// ── Helpers ─────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function getDurationBetween(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const diff = new Date(b).getTime() - new Date(a).getTime();
  return diff >= 0 ? diff : null;
}

function formatElapsed(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function LiveTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - new Date(startedAt).getTime()));

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const id = setInterval(() => setElapsed(Math.max(0, Date.now() - start)), 100);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <span className="text-[10px] text-muted-foreground/50 tabular-nums">
      {formatElapsed(elapsed)}
    </span>
  );
}

export function DurationBadge({ ms, startedAt }: { ms: number | null; startedAt?: string }) {
  if (ms !== null) {
    return (
      <span className="text-[10px] text-muted-foreground/50 tabular-nums">
        {formatDuration(ms)}
      </span>
    );
  }
  if (startedAt) {
    return <LiveTimer startedAt={startedAt} />;
  }
  return null;
}

// ── Component props ─────────────────────────────────────────────

export interface RunStepViewerProps {
  steps: StepData[];
  devMode?: boolean;
  runStatus?: string; // "running" | "completed" | "failed" | "cancelled"
}
