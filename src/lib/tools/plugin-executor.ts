import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import {
  toAbsolutePath,
  getRunArtifactsDir,
  toRelativePath,
  guessMimeType,
} from "@/lib/workspace";
import type { ToolExecutionResult, ExecutionContext } from "./types";

export interface PluginConfig {
  language: string;
  scriptPath: string;
  timeout?: number;
  dependencies?: string[];
  cwd?: string; // Override working directory (default: run artifacts dir)
  /** Extra NODE_PATH entries so require() finds plugin-local deps */
  nodePath?: string;
}

const DEFAULT_TIMEOUT = 60_000;

const RUNTIME_MAP: Record<string, string> = {
  python: process.platform === "win32" ? "python" : "python3",
  node: "node",
  bash: "bash",
  typescript: "npx",
  ruby: "ruby",
  powershell: "powershell",
};

const RUNTIME_ARGS: Record<string, string[]> = {
  typescript: ["tsx"],
};

export async function executePlugin(
  config: PluginConfig,
  input: Record<string, unknown>,
  context?: ExecutionContext,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const absolutePath = toAbsolutePath(config.scriptPath);
  const runtime = RUNTIME_MAP[config.language] ?? config.language;
  const extraArgs = RUNTIME_ARGS[config.language] ?? [];
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  // Run plugins in the artifacts directory so produced files are auto-captured
  const cwd = config.cwd
    ?? (context ? await getRunArtifactsDir(context.runId) : path.dirname(absolutePath));

  const result = await new Promise<ToolExecutionResult>((resolve) => {
    // Check if already aborted before spawning
    if (signal?.aborted) {
      resolve({ success: false, output: null, error: "Cancelled by user" });
      return;
    }

    const args = [...extraArgs, absolutePath];
    const child = spawn(runtime, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
      shell: process.platform === "win32",
      env: {
        ...process.env,
        // Prevent SSL certificate errors in pipeline subprocesses on Windows
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        // Python equivalent
        PYTHONHTTPSVERIFY: "0",
        // Allow require() to resolve deps from plugin-local node_modules
        ...(config.nodePath ? { NODE_PATH: config.nodePath } : {}),
      },
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    const safeResolve = (result: ToolExecutionResult) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    // Kill child process on abort signal
    const onAbort = () => {
      child.kill("SIGTERM");
      // Give the process a moment to terminate gracefully, then force kill
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
      }, 2000);
      safeResolve({ success: false, output: null, error: "Cancelled by user" });
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      safeResolve({
        success: false,
        output: null,
        error: `Failed to start plugin: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);

      if (code !== 0) {
        // Combine stderr and stdout for richer error context
        const errorParts: string[] = [];
        if (stderr.trim()) errorParts.push(stderr.trim());
        if (stdout.trim()) errorParts.push(`stdout:\n${stdout.trim()}`);
        const fullError = errorParts.length > 0
          ? errorParts.join("\n\n")
          : `Plugin exited with code ${code}`;
        // Smart extraction: keep full error up to 8000 chars, but if longer,
        // keep the LAST 6000 chars (where the actual exception usually is)
        // plus the FIRST 1500 chars (import/setup errors)
        let errorMsg: string;
        if (fullError.length <= 8000) {
          errorMsg = fullError;
        } else {
          const head = fullError.slice(0, 1500);
          const tail = fullError.slice(-6000);
          errorMsg = `${head}\n\n[... ${fullError.length - 7500} chars truncated ...]\n\n${tail}`;
        }
        safeResolve({
          success: false,
          output: null,
          error: errorMsg,
        });
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        safeResolve({ success: true, output: parsed });
      } catch {
        safeResolve({
          success: false,
          output: null,
          error: `Plugin returned invalid JSON: ${stdout.slice(0, 2000)}`,
        });
      }
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });

  // Track output files as artifacts
  if (result.success && context) {
    const output = result.output as Record<string, unknown> | null;
    const files = output?.files as string[] | undefined;
    if (files && Array.isArray(files)) {
      const tracked: string[] = [];
      for (const filename of files) {
        const sanitized = path.basename(filename);
        const filePath = path.join(cwd, sanitized);
        try {
          const stats = await fs.stat(filePath);

          // Deduplicate: if an artifact with the same filename already exists
          // in this run (e.g. promoted from pipeline_test), update it instead
          // of creating a duplicate
          const existing = await prisma.artifact.findFirst({
            where: { runId: context.runId, filename: sanitized, category: "file" },
          });
          if (existing) {
            await prisma.artifact.update({
              where: { id: existing.id },
              data: {
                diskPath: toRelativePath(filePath),
                sizeBytes: stats.size,
                intermediate: false,
                summary: output?.summary as string | undefined ?? null,
              },
            });
          } else {
            await prisma.artifact.create({
              data: {
                runId: context.runId,
                filename: sanitized,
                diskPath: toRelativePath(filePath),
                mimeType: guessMimeType(sanitized),
                sizeBytes: stats.size,
                category: "file",
                summary: output?.summary as string | undefined ?? null,
              },
            });
          }
          tracked.push(sanitized);
        } catch {
          // File doesn't exist — skip
        }
      }
      if (tracked.length > 0) {
        (result.output as Record<string, unknown>).trackedArtifacts = tracked;

        // Mark earlier file-write artifacts from this run as intermediate
        // since they were likely source material for the plugin
        await prisma.artifact.updateMany({
          where: {
            runId: context.runId,
            filename: { notIn: tracked },
            category: { in: ["file", "script", "data"] },
            intermediate: false,
          },
          data: { intermediate: true },
        });
      }
    }
  }

  return result;
}
