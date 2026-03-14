"use client";

import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Download,
  ExternalLink,

  ShieldCheck,
  Play,
  Package,
  ClipboardCheck,
} from "lucide-react";
import {
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { CodeBlock } from "@/components/ui/code-block";
import { isViewableFile } from "./step-viewer-types";

// ── Pipeline detail sheet components ────────────────────────────
// Modal views for pipeline step types (research, review, etc.).

export function PipelineExecutionDetail({ data }: { data: { pluginName: string; success: boolean; error?: string; outputFiles: string[]; outputArtifacts?: { id: string; filename: string }[]; summary?: string } }) {
  const artifactMap = new Map<string, string>();
  if (data.outputArtifacts) {
    for (const a of data.outputArtifacts) {
      artifactMap.set(a.filename, a.id);
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className={cn("flex items-center gap-2", data.success ? "text-cyan-400" : "text-red-400")}>
          <Play className="h-4 w-4" />
          Pipeline Execution
        </SheetTitle>
        <SheetDescription>
          Test execution of {data.pluginName}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-4">
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Status</h4>
          <div className={cn("flex items-center gap-2 text-sm", data.success ? "text-green-400" : "text-red-400")}>
            {data.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span className="font-medium">{data.success ? "Success" : "Failed"}</span>
          </div>
        </div>
        {data.error && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Error</h4>
            <CodeBlock>{data.error}</CodeBlock>
          </div>
        )}
        {data.summary && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Summary</h4>
            <p className="text-sm text-muted-foreground">{data.summary}</p>
          </div>
        )}
        {data.outputFiles.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
              Output Files ({data.outputFiles.length})
            </h4>
            <div className="rounded-md border border-muted-foreground/20 divide-y divide-muted-foreground/10">
              {data.outputFiles.map((file, i) => {
                const artifactId = artifactMap.get(file);
                const viewable = isViewableFile(file);
                return artifactId ? (
                  <a
                    key={i}
                    href={viewable ? `/api/artifacts/${artifactId}/download?inline=1` : `/api/artifacts/${artifactId}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-mono text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="flex-1">{file}</span>
                    {viewable
                      ? <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                      : <Download className="h-3 w-3 shrink-0 opacity-60" />}
                  </a>
                ) : (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-sm font-mono text-muted-foreground">
                    <FileText className="h-3 w-3 shrink-0 text-cyan-400" />
                    {file}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export function PipelineDepsDetail({ data }: { data: { success: boolean; language: string; packages: string[]; error?: string } }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle className={cn("flex items-center gap-2", data.success ? "" : "text-red-400")}>
          <Package className="h-4 w-4" />
          Dependency Installation
        </SheetTitle>
        <SheetDescription>
          {data.success ? "Dependencies installed before plugin execution" : "Dependency installation failed"}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-4">
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Language</h4>
          <p className="text-sm font-mono">{data.language}</p>
        </div>
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
            Packages ({data.packages.length})
          </h4>
          <div className="rounded-md border border-muted-foreground/20 divide-y divide-muted-foreground/10">
            {data.packages.map((pkg, i) => (
              <div key={i} className="px-3 py-1.5 text-sm font-mono">{pkg}</div>
            ))}
          </div>
        </div>
        {data.error && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Error</h4>
            <CodeBlock>{data.error}</CodeBlock>
          </div>
        )}
      </div>
    </>
  );
}

export function PipelineSummaryDetail({ data }: { data: { pluginName: string; passed: boolean | null; totalAttempts: number; maxAttempts: number; reviewSkipped?: boolean; lastIssues: string[]; lastSummary: string } }) {
  const isPassed = data.passed === true;
  return (
    <>
      <SheetHeader>
        <SheetTitle className={cn("flex items-center gap-2", isPassed ? "text-green-400" : "text-red-400")}>
          <ClipboardCheck className="h-4 w-4" />
          Pipeline Summary
        </SheetTitle>
        <SheetDescription>
          Development cycle results for {data.pluginName}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-4">
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Verdict</h4>
          <div className={cn("flex items-center gap-2 text-sm", isPassed ? "text-green-400" : "text-red-400")}>
            {isPassed ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span className="font-medium">{isPassed ? "Passed" : "Failed"}</span>
          </div>
        </div>
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Attempts</h4>
          <p className="text-sm text-foreground">{data.totalAttempts} of {data.maxAttempts} maximum</p>
        </div>
        {data.reviewSkipped && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Review</h4>
            <p className="text-sm text-muted-foreground">Auto-passed — text/JSON output verified by execution</p>
          </div>
        )}
        {data.lastSummary && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Final Review Summary</h4>
            <p className="text-sm text-muted-foreground">{data.lastSummary}</p>
          </div>
        )}
        {data.lastIssues.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
              Remaining Issues ({data.lastIssues.length})
            </h4>
            <div className="space-y-1.5">
              {data.lastIssues.map((issue, i) => (
                <div key={i} className="flex gap-2 items-start text-xs">
                  <span className="text-red-400 font-medium shrink-0">{i + 1}.</span>
                  <span className="text-muted-foreground">{issue}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export function ReviewDetail({ data }: { data: { pluginName: string; model: string; passed: boolean; issues: string[]; summary: string; attempt: number } }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle className={cn("flex items-center gap-2", data.passed ? "text-green-400" : "text-red-400")}>
          <ShieldCheck className="h-4 w-4" />
          Review {data.attempt > 1 ? `(Attempt ${data.attempt})` : ""}
        </SheetTitle>
        <SheetDescription>
          Review of {data.pluginName}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-4 px-4 pb-4">
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Verdict</h4>
          <div className={cn("flex items-center gap-2 text-sm", data.passed ? "text-green-400" : "text-red-400")}>
            {data.passed ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span className="font-medium">{data.passed ? "Passed" : "Failed"}</span>
          </div>
        </div>
        {data.model && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Model</h4>
            <p className="text-sm font-mono">{data.model}</p>
          </div>
        )}
        {data.summary && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">Summary</h4>
            <p className="text-sm text-muted-foreground">{data.summary}</p>
          </div>
        )}
        {data.issues.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
              Issues ({data.issues.length})
            </h4>
            <div className="space-y-1.5">
              {data.issues.map((issue, i) => (
                <div key={i} className="flex gap-2 items-start text-xs">
                  <span className="text-red-400 font-medium shrink-0">{i + 1}.</span>
                  <span className="text-muted-foreground">{issue}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
