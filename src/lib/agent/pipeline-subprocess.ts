/**
 * pipeline-subprocess.ts
 *
 * Subprocess execution utilities for the code pipeline: quick commands,
 * version checking, syntax validation, dependency installation, and
 * plugin execution. Extracted from pipeline-utils.ts for cohesion.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { prisma } from "@/lib/db/prisma";
import { executePlugin, type PluginConfig } from "@/lib/tools/plugin-executor";
import { getRunArtifactsDir, toRelativePath, guessMimeType, getPluginDir, ensurePluginPackageJson } from "@/lib/workspace";
import { createLog } from "@/lib/logs/logger";

// Python standard library modules (common subset) — anything NOT in this list
// is assumed to be a third-party package that needs pip install.
const PYTHON_STDLIB = new Set([
  "abc", "argparse", "ast", "asyncio", "base64", "binascii", "bisect",
  "calendar", "cgi", "cmath", "codecs", "collections", "colorsys",
  "concurrent", "configparser", "contextlib", "copy", "csv", "ctypes",
  "dataclasses", "datetime", "decimal", "difflib", "dis", "email",
  "enum", "errno", "fcntl", "fileinput", "fnmatch", "fractions",
  "ftplib", "functools", "gc", "getpass", "gettext", "glob", "gzip",
  "hashlib", "heapq", "hmac", "html", "http", "imaplib", "importlib",
  "inspect", "io", "ipaddress", "itertools", "json", "keyword",
  "linecache", "locale", "logging", "lzma", "mailbox", "math",
  "mimetypes", "multiprocessing", "netrc", "numbers", "operator", "os",
  "pathlib", "pdb", "pickle", "pkgutil", "platform", "plistlib",
  "poplib", "posixpath", "pprint", "profile", "pstats", "py_compile",
  "queue", "quopri", "random", "re", "readline", "reprlib", "resource",
  "rlcompleter", "runpy", "sched", "secrets", "select", "selectors",
  "shelve", "shlex", "shutil", "signal", "site", "smtplib", "socket",
  "socketserver", "sqlite3", "ssl", "stat", "statistics", "string",
  "struct", "subprocess", "sys", "syslog", "tarfile", "tempfile",
  "test", "textwrap", "threading", "time", "timeit", "tkinter",
  "token", "tokenize", "tomllib", "traceback", "tracemalloc", "turtle",
  "types", "typing", "unicodedata", "unittest", "urllib", "uuid",
  "venv", "warnings", "wave", "weakref", "webbrowser", "winreg",
  "wsgiref", "xml", "xmlrpc", "zipfile", "zipimport", "zlib",
  // Common aliases / sub-packages that resolve to stdlib
  "_thread", "posix", "nt", "msvcrt", "builtins",
]);

/** Scan a Python script for imports and return third-party package names. */
// Pre-compiled patterns for dependency detection
const PY_IMPORT_RE = /^import\s+([\w.]+)/;
const PY_FROM_IMPORT_RE = /^from\s+([\w.]+)\s+import/;
const IMPORT_TO_PIP: Record<string, string> = {
  PIL: "Pillow",
  cv2: "opencv-python",
  sklearn: "scikit-learn",
  bs4: "beautifulsoup4",
  yaml: "pyyaml",
  dotenv: "python-dotenv",
  attr: "attrs",
  gi: "PyGObject",
};

function detectPythonDeps(script: string): string[] {
  const deps = new Set<string>();
  for (const line of script.split("\n")) {
    const trimmed = line.trim();
    let m = trimmed.match(PY_IMPORT_RE);
    if (m) {
      const topLevel = m[1].split(".")[0];
      if (!PYTHON_STDLIB.has(topLevel)) deps.add(topLevel);
      continue;
    }
    m = trimmed.match(PY_FROM_IMPORT_RE);
    if (m) {
      const topLevel = m[1].split(".")[0];
      if (!PYTHON_STDLIB.has(topLevel)) deps.add(topLevel);
    }
  }
  return [...deps].map((d) => IMPORT_TO_PIP[d] ?? d);
}

// Node.js built-in modules — anything NOT in this list is a third-party package.
const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster",
  "console", "constants", "crypto", "dgram", "diagnostics_channel",
  "dns", "domain", "events", "fs", "http", "http2", "https",
  "inspector", "module", "net", "os", "path", "perf_hooks",
  "process", "punycode", "querystring", "readline", "repl",
  "stream", "string_decoder", "sys", "timers", "tls", "trace_events",
  "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
  // node: prefixed versions are handled by stripping prefix
]);

const NODE_REQUIRE_RE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/;
const NODE_ESM_IMPORT_RE = /import\s+.*\s+from\s+['"]([^'"]+)['"]/;

/** Scan a Node.js script for require()/import and return third-party package names. */
function detectNodeDeps(script: string): string[] {
  const deps = new Set<string>();
  for (const line of script.split("\n")) {
    const trimmed = line.trim();
    let m = trimmed.match(NODE_REQUIRE_RE);
    if (m) {
      const pkg = m[1].replace(/^node:/, "");
      const topLevel = pkg.startsWith("@") ? pkg.split("/").slice(0, 2).join("/") : pkg.split("/")[0];
      if (!NODE_BUILTINS.has(topLevel) && !topLevel.startsWith(".")) deps.add(topLevel);
    }
    m = trimmed.match(NODE_ESM_IMPORT_RE);
    if (m) {
      const pkg = m[1].replace(/^node:/, "");
      const topLevel = pkg.startsWith("@") ? pkg.split("/").slice(0, 2).join("/") : pkg.split("/")[0];
      if (!NODE_BUILTINS.has(topLevel) && !topLevel.startsWith(".")) deps.add(topLevel);
    }
  }
  return [...deps];
}

// ── Quick command runner ─────────────────────────────────────

export async function runQuickCommand(cmd: string, args: string[], options?: { shell?: boolean }): Promise<string | null> {
  try {
    const proc = spawn(cmd, args, {
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
      shell: options?.shell,
    });
    const chunks: Buffer[] = [];
    proc.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    const code = await new Promise<number>((resolve) => {
      proc.on("close", (c) => resolve(c ?? 1));
      proc.on("error", () => resolve(1));
    });
    return code === 0 ? Buffer.concat(chunks).toString("utf-8").trim() : null;
  } catch {
    return null;
  }
}

// ── Version checking ─────────────────────────────────────────

export async function checkInstalledVersions(
  language: string,
  dependencies: string[],
): Promise<string | null> {
  const sections: string[] = [];

  // ── Runtime environment ──
  const envLines: string[] = [];
  envLines.push(`- **Platform**: ${process.platform} (${process.arch})`);
  envLines.push(`- **Node.js**: ${process.version}`);

  if (language === "python") {
    const [pyVersion, pipVersion] = await Promise.all([
      runQuickCommand("python", ["--version"]),
      runQuickCommand("python", ["-m", "pip", "--version"]),
    ]);
    envLines.push(`- **Python**: ${pyVersion ?? "NOT FOUND"}`);
    if (pipVersion) {
      const match = pipVersion.match(/pip\s+([\d.]+)/);
      envLines.push(`- **pip**: ${match?.[1] ?? pipVersion.split(" ")[1] ?? "installed"}`);
    }
  } else if (language === "node" || language === "typescript") {
    const npmVersion = await runQuickCommand("npm", ["--version"], { shell: true });
    envLines.push(`- **npm**: ${npmVersion ?? "NOT FOUND"}`);
  }

  sections.push(`## Runtime Environment\n\n${envLines.join("\n")}`);

  // ── Package versions ──
  if (dependencies.length > 0) {
    const results: string[] = [];

    if (language === "python") {
      const checks = dependencies.map(async (dep) => {
        const pkgName = dep.replace(/[<>=!~].*/g, "").trim();
        if (!pkgName) return null;
        const output = await runQuickCommand("python", ["-m", "pip", "show", pkgName]);
        if (output) {
          const versionMatch = output.match(/^Version:\s*(.+)$/m);
          const version = versionMatch?.[1]?.trim() ?? "unknown";
          return `- \`${pkgName}\` version **${version}** installed`;
        }
        return `- \`${pkgName}\` — NOT INSTALLED (will be installed during pipeline)`;
      });
      results.push(...(await Promise.all(checks)).filter((r): r is string => r !== null));
    } else if (language === "node" || language === "typescript") {
      const checks = dependencies.map(async (dep) => {
        const pkgName = dep.replace(/@[^@/]+$/, "").trim();
        if (!pkgName) return null;
        const output = await runQuickCommand("npm", ["list", pkgName, "--depth=0", "--json"], { shell: true });
        if (output) {
          try {
            const parsed = JSON.parse(output);
            const version = parsed?.dependencies?.[pkgName]?.version;
            return version
              ? `- \`${pkgName}\` version **${version}** installed`
              : `- \`${pkgName}\` — NOT INSTALLED`;
          } catch {
            return `- \`${pkgName}\` — version check failed`;
          }
        }
        return `- \`${pkgName}\` — NOT INSTALLED (will be installed during pipeline)`;
      });
      results.push(...(await Promise.all(checks)).filter((r): r is string => r !== null));
    }

    if (results.length > 0) {
      sections.push(`## Installed Package Versions\n\nIMPORTANT: Only use APIs that exist in these specific versions. Check documentation for version compatibility.\n\n${results.join("\n")}`);
    }
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}

// ── Syntax validation ────────────────────────────────────────

export async function validateSyntax(script: string, language: string): Promise<string | null> {
  const tmpDir = path.join(process.cwd(), "workspace", "_syntax_check");
  await fs.mkdir(tmpDir, { recursive: true });

  const ext = language === "python" ? ".py" : language === "typescript" ? ".ts" : language === "node" ? ".js" : ".sh";
  const tmpFile = path.join(tmpDir, `_check${ext}`);

  try {
    await fs.writeFile(tmpFile, script, "utf-8");

    let cmd: string;
    let args: string[];
    const useShell = false;

    if (language === "python") {
      cmd = "python";
      args = ["-m", "py_compile", tmpFile];
    } else if (language === "node" || language === "typescript") {
      cmd = "node";
      args = ["--check", tmpFile];
    } else {
      // No syntax check available for this language
      return null;
    }

    const proc = spawn(cmd, args, {
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
      shell: useShell,
    });

    const stderrChunks: Buffer[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    const stdoutChunks: Buffer[] = [];
    proc.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));

    const code = await new Promise<number>((resolve) => {
      proc.on("close", (c) => resolve(c ?? 1));
      proc.on("error", () => resolve(1));
    });

    if (code !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
      // Clean up temp file path from error message for clarity
      const errorMsg = (stderr || stdout || `Syntax check exited with code ${code}`)
        .replace(new RegExp(tmpFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "<script>");
      return errorMsg.slice(0, 3000);
    }

    return null; // Valid
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

// ── Pipeline dependency installation ─────────────────────────

export async function installPipelineDeps(
  language: string,
  dependencies: string[],
  runId: string,
  recordStep: (type: string, content: unknown, toolId?: string) => Promise<void>,
  signal?: AbortSignal,
  pluginDir?: string,
): Promise<{ success: boolean; error?: string }> {
  if (dependencies.length === 0) return { success: true };
  if (signal?.aborted) return { success: false, error: "Cancelled by user" };

  const installCommands: Record<string, { cmd: string; args: string[] }> = {
    python: {
      cmd: process.platform === "win32" ? "python" : "python3",
      args: ["-m", "pip", "install", "--quiet"],
    },
    node: { cmd: "npm", args: ["install", "--save"] },
    typescript: { cmd: "npm", args: ["install", "--save"] },
  };

  const installInfo = installCommands[language];
  if (!installInfo) {
    return { success: true }; // Unknown language — skip dep install
  }

  // Ensure plugin dir has its own package.json so npm doesn't pollute root
  if (pluginDir && (language === "node" || language === "typescript")) {
    await ensurePluginPackageJson(pluginDir);
  }

  return new Promise((resolve) => {
    const child = spawn(installInfo.cmd, [...installInfo.args, ...dependencies], {
      cwd: pluginDir, // Install deps in plugin dir, not project root
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      shell: process.platform === "win32",
      env: {
        ...process.env,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        PYTHONHTTPSVERIFY: "0",
      },
    });

    let resolved = false;
    const safeResolve = (result: { success: boolean; error?: string }) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const onAbort = () => {
      child.kill("SIGTERM");
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* */ } }, 2000);
      safeResolve({ success: false, error: "Cancelled by user" });
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    child.on("close", async (code) => {
      signal?.removeEventListener("abort", onAbort);
      const success = code === 0;
      await recordStep("pipeline_deps", {
        success,
        language,
        packages: dependencies,
        error: success ? undefined : (stderr || `Exit code ${code}`).slice(0, 300),
      }).catch(() => {});

      safeResolve({
        success,
        error: success ? undefined : (stderr || `Dependency install failed with code ${code}`).slice(0, 500),
      });
    });

    child.on("error", async (err) => {
      signal?.removeEventListener("abort", onAbort);
      await recordStep("pipeline_deps", {
        success: false,
        language,
        packages: dependencies,
        error: err.message.slice(0, 300),
      }).catch(() => {});
      safeResolve({ success: false, error: err.message });
    });
  });
}

// ── Plugin execution in pipeline ─────────────────────────────

/** Execute the plugin script in-pipeline to produce output files for review.
 *  Uses a temp subdirectory so test files don't pollute the main artifacts. */
export async function executePluginInPipeline(
  toolArgs: Record<string, unknown>,
  currentScript: string,
  testInputs: Record<string, unknown>,
  runId: string,
  recordStep: (type: string, content: unknown, toolId?: string) => Promise<void>,
  signal?: AbortSignal,
): Promise<{ success: boolean; outputFiles: string[]; error?: string }> {
  const language = (toolArgs.language as string) ?? "python";
  const pluginName = (toolArgs.name as string) ?? "plugin";

  try {
    // Resolve plugin dir + artifacts dir in parallel (both create directories)
    const [pluginDir, artifactsDir] = await Promise.all([
      getPluginDir(pluginName),
      getRunArtifactsDir(runId),
    ]);

    // Install dependencies before execution
    const explicitDeps = Array.isArray(toolArgs.dependencies)
      ? (toolArgs.dependencies as string[])
      : [];
    // Auto-detect third-party imports from script when no explicit deps provided
    let autoDetectedDeps: string[] = [];
    if (explicitDeps.length === 0) {
      if (language === "python") {
        autoDetectedDeps = detectPythonDeps(currentScript);
      } else if (language === "node" || language === "typescript") {
        autoDetectedDeps = detectNodeDeps(currentScript);
      }
    }
    const deps = [...new Set([...explicitDeps, ...autoDetectedDeps])];
    if (autoDetectedDeps.length > 0) {
      createLog("info", "developer", `Auto-detected ${language} deps: ${autoDetectedDeps.join(", ")}`, { pluginName }, runId).catch(() => {});
    }
    if (deps.length > 0) {
      const depResult = await installPipelineDeps(language, deps, runId, recordStep, signal, pluginDir);
      if (!depResult.success) {
        return { success: false, outputFiles: [], error: `Dependency install failed: ${depResult.error}` };
      }
    }
    const testDir = path.join(artifactsDir, "_pipeline_test");
    await fs.mkdir(testDir, { recursive: true });

    const ext = language === "python" ? ".py" : language === "typescript" ? ".ts" : language === "node" ? ".js" : ".sh";
    const tempScriptFile = path.join(testDir, `_pipeline_test${ext}`);
    await fs.writeFile(tempScriptFile, currentScript, "utf-8");

    // Execute the plugin in the test directory
    // Set NODE_PATH so require() can find deps installed in the plugin's own node_modules
    const pluginNodeModules = path.join(pluginDir, "node_modules");
    const pluginConfig: PluginConfig = {
      language,
      scriptPath: tempScriptFile,
      timeout: 120_000,
      cwd: testDir,
      nodePath: (language === "node" || language === "typescript") ? pluginNodeModules : undefined,
    };

    // No context → no artifact DB records for test outputs (prevents duplicate artifacts)
    const result = await executePlugin(pluginConfig, testInputs, undefined, signal);

    // Clean up temp script (keep output files for review)
    await fs.unlink(tempScriptFile).catch(() => {});

    if (!result.success) {
      await recordStep("pipeline_execution", {
        pluginName,
        success: false,
        error: result.error ?? "Plugin execution failed",
        outputFiles: [],
      });
      return { success: false, outputFiles: [], error: result.error ?? "Plugin execution failed" };
    }

    // Check if plugin self-reported an error (process exited 0 but output says "error")
    const output = result.output as Record<string, unknown> | null;
    if (output?.status === "error") {
      const pluginError = (output.message as string) ?? "Plugin reported an error";
      await recordStep("pipeline_execution", {
        pluginName,
        success: false,
        error: pluginError,
        outputFiles: [],
      });
      return { success: false, outputFiles: [], error: pluginError };
    }

    // Extract output files from the test directory
    const files = output?.files as string[] | undefined;
    const outputFiles: string[] = [];
    const outputArtifacts: { id: string; filename: string }[] = [];

    if (files && Array.isArray(files)) {
      // Remove previous pipeline_test artifacts (they point to files that got overwritten)
      await prisma.artifact.deleteMany({
        where: { runId, category: "pipeline_test" },
      }).catch(() => {});

      for (const filename of files) {
        const sanitized = path.basename(filename);
        const filePath = path.join(testDir, sanitized);
        try {
          const stats = await fs.stat(filePath);
          outputFiles.push(filePath);
          // Save as intermediate artifact so users can inspect pipeline outputs
          const artifact = await prisma.artifact.create({
            data: {
              runId,
              filename: `_pipeline_${sanitized}`,
              diskPath: toRelativePath(filePath),
              mimeType: guessMimeType(sanitized),
              sizeBytes: stats.size,
              category: "pipeline_test",
              intermediate: true,
            },
          });
          outputArtifacts.push({ id: artifact.id, filename: sanitized });
        } catch {
          // File doesn't exist — skip
        }
      }
    }

    // Empty-output check: if plugin claimed to produce files but none exist on disk, fail
    if (files && files.length > 0 && outputFiles.length === 0) {
      const emptyErr = `Plugin reported ${files.length} output file(s) but none were found on disk: ${files.join(", ")}`;
      await recordStep("pipeline_execution", {
        pluginName,
        success: false,
        error: emptyErr,
        outputFiles: [],
      });
      return { success: false, outputFiles: [], error: emptyErr };
    }

    await recordStep("pipeline_execution", {
      pluginName,
      success: true,
      outputFiles: outputFiles.map((f) => path.basename(f)),
      outputArtifacts,
      summary: (output?.summary as string) ?? null,
    });

    return { success: true, outputFiles };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await recordStep("pipeline_execution", {
      pluginName,
      success: false,
      error: errorMsg,
      outputFiles: [],
    });
    return { success: false, outputFiles: [], error: errorMsg };
  }
}
