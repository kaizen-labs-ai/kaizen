import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import type { ToolExecutionResult, ContextualToolExecutorFn } from "../types";
import {
  getRunArtifactsDir,
  resolveArtifactPath,
  toRelativePath,
  guessMimeType,
} from "@/lib/workspace";

// ── file-read (blocks vault/sensitive paths) ─────────────

const BLOCKED_PATTERNS = [
  /[/\\]\.vault-key$/i,
  /[/\\]vault\.enc$/i,
  /[/\\]data[/\\]\.vault/i,
  /[/\\]\.env/i,
];

export async function fileReadExecutor(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const filePath = input.path as string;
  if (!filePath) return { success: false, output: null, error: "path is required" };

  const resolved = path.resolve(filePath);
  if (BLOCKED_PATTERNS.some((p) => p.test(resolved))) {
    return { success: false, output: null, error: "Access denied: this file is protected" };
  }

  try {
    const content = await fs.readFile(resolved, "utf-8");
    return { success: true, output: { content } };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
}

// ── file-write (sandboxed to workspace/artifacts/<runId>/) ──

export const fileWriteExecutorFactory: ContextualToolExecutorFn = (ctx) => {
  return async (input): Promise<ToolExecutionResult> => {
    // Accept both "filename" (primary) and "path" (legacy alias)
    const filename = (input.filename ?? input.path) as string;
    const content = input.content as string;
    const summary = input.summary as string | undefined;
    const intermediate = input.intermediate === true;

    if (!filename || content === undefined) {
      return { success: false, output: null, error: "filename and content are required" };
    }

    try {
      const runDir = await getRunArtifactsDir(ctx.runId);
      const resolved = resolveArtifactPath(runDir, filename);

      await fs.writeFile(resolved, content, "utf-8");
      const stats = await fs.stat(resolved);

      const diskPath = toRelativePath(resolved);
      const mimeType = guessMimeType(filename);

      const artifact = await prisma.artifact.create({
        data: {
          runId: ctx.runId,
          filename: path.basename(filename),
          diskPath,
          mimeType,
          sizeBytes: stats.size,
          category: categorizeFile(filename),
          summary: summary ?? null,
          intermediate,
        },
      });

      return {
        success: true,
        output: {
          artifactId: artifact.id,
          filename: artifact.filename,
          bytesWritten: stats.size,
          message: `File saved as "${artifact.filename}"`,
        },
      };
    } catch (err) {
      return { success: false, output: null, error: (err as Error).message };
    }
  };
};

function categorizeFile(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if ([".py", ".js", ".ts", ".sh", ".sql"].includes(ext)) return "script";
  if ([".json", ".csv", ".xml", ".yaml", ".yml"].includes(ext)) return "data";
  return "file";
}
