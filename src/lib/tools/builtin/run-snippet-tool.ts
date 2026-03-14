import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ToolExecutorFn, ContextualToolExecutorFn, ToolExecutionResult } from "../types";

const SNIPPET_TIMEOUT = 15_000;

// Pre-compiled patterns for blocking vault/secret access in snippets
const BLOCKED_CODE_PATTERNS = [
  /vault\.enc/i,
  /\.vault-key/i,
  /vault\.ts/i,
  /getSecret|setSecret|getMasterPassphrase/i,
  /data[/\\]\.vault/i,
];

/**
 * Execute a short code snippet in a sandboxed temp directory scoped to the current run.
 * Uses workspace/_snippets/{runId}/ so cleanup happens automatically on chat deletion.
 */
export const runSnippetExecutorFactory: ContextualToolExecutorFn = (ctx) => {
  return async (input: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const code = input.code as string | undefined;
    if (!code) return { success: false, output: null, error: "code is required" };

    const language = (input.language as string) ?? "python";
    const timeout = (input.timeout as number) ?? SNIPPET_TIMEOUT;

    const tmpDir = path.join(process.cwd(), "workspace", "_snippets", ctx.runId);
    await fs.mkdir(tmpDir, { recursive: true });

    // Block snippets that attempt to access vault/secret files
    if (BLOCKED_CODE_PATTERNS.some((p) => p.test(code))) {
      return { success: false, output: null, error: "Access denied: snippet references protected vault files" };
    }

    const ext = language === "python" ? ".py" : ".js";
    const tmpFile = path.join(tmpDir, `_snippet_${Date.now()}${ext}`);
    await fs.writeFile(tmpFile, code, "utf-8");

    try {
      const cmd = language === "python" ? "python" : "node";
      const proc = spawn(cmd, [tmpFile], {
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
        cwd: tmpDir,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      proc.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      const exitCode = await new Promise<number>((resolve) => {
        proc.on("close", (c) => resolve(c ?? 1));
        proc.on("error", () => resolve(1));
      });

      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").slice(0, 4000);
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").slice(0, 4000);

      return {
        success: exitCode === 0,
        output: { success: exitCode === 0, stdout, stderr },
        error: exitCode !== 0 ? stderr || `Snippet exited with code ${exitCode}` : undefined,
      };
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  };
};
