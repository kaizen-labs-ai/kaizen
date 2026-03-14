import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import type {
  ToolExecutorFn,
  ToolExecutionResult,
  ContextualToolExecutorFn,
} from "../types";
import {
  toRelativePath,
  toAbsolutePath,
  getPluginDir,
  resolvePluginScript,
  ensurePluginPackageJson,
} from "@/lib/workspace";

// ── Constants ────────────────────────────────────────────

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  python: ".py",
  node: ".js",
  bash: ".sh",
  typescript: ".ts",
  ruby: ".rb",
  powershell: ".ps1",
};

export const INSTALL_COMMANDS: Record<string, { cmd: string; args: string[] }> = {
  python: {
    cmd: process.platform === "win32" ? "python" : "python3",
    args: ["-m", "pip", "install"],
  },
  node: { cmd: "npm", args: ["install", "--save"] },
  typescript: { cmd: "npm", args: ["install", "--save"] },
  ruby: { cmd: "gem", args: ["install"] },
};

// ── create-plugin (contextual — needs runId for artifact) ──

export const createPluginExecutorFactory: ContextualToolExecutorFn = (ctx) => {
  return async (input): Promise<ToolExecutionResult> => {
    const {
      name,
      description,
      language,
      script,
      inputSchema,
      timeout,
      dependencies,
    } = input;

    if (!name || !description || !language || !script) {
      return {
        success: false,
        output: null,
        error: "name, description, language, and script are required",
      };
    }

    // Cap description to a short one-liner
    const shortDescription = (description as string).length > 100
      ? (description as string).substring(0, 100).trimEnd() + "…"
      : (description as string);

    // Check if a plugin with this name already exists (also check hyphen/underscore variant)
    const existing = await prisma.tool.findUnique({ where: { name: name as string } });
    const altName = (name as string).includes("-")
      ? (name as string).replace(/-/g, "_")
      : (name as string).replace(/_/g, "-");
    const existingAlt = existing ? null : await prisma.tool.findUnique({ where: { name: altName } });
    if (existing || existingAlt) {
      const realName = (existing ?? existingAlt)!.name;
      return {
        success: false,
        output: null,
        error: `A plugin named "${realName}" already exists. Use edit-plugin to modify it instead of create-plugin.`,
      };
    }

    try {
      const pluginName = name as string;
      const lang = language as string;
      const ext = LANGUAGE_EXTENSIONS[lang] ?? `.${lang}`;
      const filename = `main${ext}`;

      const pluginDir = await getPluginDir(pluginName);
      const scriptPath = resolvePluginScript(pluginDir, filename);

      await fs.writeFile(scriptPath, script as string, "utf-8");
      const stats = await fs.stat(scriptPath);

      const relativePath = toRelativePath(scriptPath);
      const config = {
        language: lang,
        scriptPath: relativePath,
        timeout: (timeout as number) ?? 60000,
        dependencies: (dependencies as string[]) ?? [],
      };

      const tool = await prisma.tool.create({
        data: {
          name: pluginName,
          description: shortDescription,
          type: "plugin",
          config: JSON.stringify(config),
          inputSchema: inputSchema
            ? JSON.stringify(inputSchema)
            : JSON.stringify({ type: "object", properties: {} }),
          enabled: true,
          createdBy: "agent",
        },
      });

      // Auto-install dependencies if provided
      let installWarning: string | undefined;
      const deps = (dependencies as string[]) ?? [];
      if (deps.length > 0) {
        const installInfo = INSTALL_COMMANDS[lang];
        if (installInfo) {
          // Ensure plugin dir has its own package.json so npm doesn't pollute root
          if (lang === "node" || lang === "typescript") {
            await ensurePluginPackageJson(pluginDir);
          }
          const installResult = await new Promise<{ stderr: string; code: number | null }>((resolve) => {
            const child = spawn(installInfo.cmd, [...installInfo.args, ...deps], {
              cwd: pluginDir,
              stdio: ["ignore", "pipe", "pipe"],
              timeout: 120_000,
              shell: process.platform === "win32",
            });
            let stderr = "";
            child.stdout.on("data", () => {});
            child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
            child.on("error", (err) => { resolve({ stderr: err.message, code: 1 }); });
            child.on("close", (code) => { resolve({ stderr, code }); });
          });

          if (installResult.code !== 0) {
            installWarning = `Dependencies install failed: ${installResult.stderr || `exit code ${installResult.code}`}`;
          }
        }
      }

      return {
        success: true,
        output: {
          toolId: tool.id,
          name: pluginName,
          scriptPath: relativePath,
          depsInstalled: deps.length > 0 && !installWarning,
          installWarning,
          message: installWarning
            ? `Plugin "${pluginName}" created but dependency install failed: ${installWarning}`
            : `Plugin "${pluginName}" created${deps.length > 0 ? ` with ${deps.length} dependencies installed` : ""} and available as a tool`,
        },
      };
    } catch (err) {
      return { success: false, output: null, error: (err as Error).message };
    }
  };
};

// ── install-plugin-deps ──────────────────────────────────

export const installPluginDepsExecutor: ToolExecutorFn = async (
  input
): Promise<ToolExecutionResult> => {
  const pluginName = input.pluginName as string;
  const packages = input.packages as string[];

  if (!pluginName || !packages || packages.length === 0) {
    return {
      success: false,
      output: null,
      error: "pluginName and packages are required",
    };
  }

  try {
    const tool = await prisma.tool.findFirst({
      where: { name: pluginName, type: "plugin" },
    });

    if (!tool) {
      return {
        success: false,
        output: null,
        error: `Plugin "${pluginName}" not found`,
      };
    }

    const config = JSON.parse(tool.config) as {
      language: string;
      scriptPath: string;
      dependencies?: string[];
    };

    const installInfo = INSTALL_COMMANDS[config.language];
    if (!installInfo) {
      return {
        success: false,
        output: null,
        error: `No package manager configured for language: ${config.language}`,
      };
    }

    const pluginDir = path.dirname(
      path.resolve(process.cwd(), config.scriptPath)
    );

    // Ensure plugin dir has its own package.json so npm doesn't pollute root
    if (config.language === "node" || config.language === "typescript") {
      await ensurePluginPackageJson(pluginDir);
    }

    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
      const child = spawn(installInfo.cmd, [...installInfo.args, ...packages], {
        cwd: pluginDir,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
        shell: process.platform === "win32",
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", (err) => {
        resolve({ stdout: "", stderr: err.message, code: 1 });
      });
      child.on("close", (code) => {
        resolve({ stdout, stderr, code });
      });
    });

    if (result.code !== 0) {
      return {
        success: false,
        output: null,
        error: result.stderr || `Install failed with code ${result.code}`,
      };
    }

    // Update tool config with installed dependencies
    const existingDeps = config.dependencies ?? [];
    const allDeps = [...new Set([...existingDeps, ...packages])];
    await prisma.tool.update({
      where: { id: tool.id },
      data: {
        config: JSON.stringify({ ...config, dependencies: allDeps }),
      },
    });

    return {
      success: true,
      output: {
        message: `Installed ${packages.length} package(s): ${packages.join(", ")}`,
        warnings: result.stderr || undefined,
      },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
};

// ── list-plugins ─────────────────────────────────────────

export const listPluginsExecutor: ToolExecutorFn = async (): Promise<ToolExecutionResult> => {
  try {
    const plugins = await prisma.tool.findMany({
      where: { type: "plugin" },
      orderBy: { name: "asc" },
    });

    return {
      success: true,
      output: {
        plugins: plugins.map((p) => {
          const config = JSON.parse(p.config) as {
            language: string;
            dependencies?: string[];
          };
          return {
            name: p.name,
            description: p.description,
            language: config.language,
            enabled: p.enabled,
            dependencies: config.dependencies ?? [],
          };
        }),
      },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
};

// ── edit-plugin ──────────────────────────────────────────

export const editPluginExecutor: ToolExecutorFn = async (
  input
): Promise<ToolExecutionResult> => {
  // Normalize "code" → "script" alias (some models use "code" instead of "script")
  const { name, description, inputSchema } = input;
  const script = input.script ?? input.code;

  if (!name) {
    return {
      success: false,
      output: null,
      error: "name is required. Use list-plugins to find the plugin name first.",
    };
  }

  // Changing inputSchema without updating the script is dangerous — the script
  // still expects the old parameters. Reject and tell the agent to include the
  // script update too so the code pipeline can validate the change end-to-end.
  if (inputSchema && !script) {
    return {
      success: false,
      output: null,
      error: "Cannot update inputSchema without also providing the updated script. The script must be updated to match the new schema. Call edit-plugin with both script and inputSchema together.",
    };
  }

  try {
    let tool = await prisma.tool.findFirst({
      where: { name: name as string, type: "plugin" },
    });
    // Fuzzy match: try hyphen ↔ underscore normalization
    if (!tool) {
      const altName = (name as string).includes("-")
        ? (name as string).replace(/-/g, "_")
        : (name as string).replace(/_/g, "-");
      tool = await prisma.tool.findFirst({
        where: { name: altName, type: "plugin" },
      });
    }

    if (!tool) {
      return { success: false, output: null, error: `Plugin "${name}" not found` };
    }

    const config = JSON.parse(tool.config) as { scriptPath: string };
    const dbUpdates: Record<string, unknown> = {};

    if (description) {
      const desc = (description as string).length > 100
        ? (description as string).substring(0, 100).trimEnd() + "…"
        : (description as string);
      dbUpdates.description = desc;
    }
    if (inputSchema) dbUpdates.inputSchema = JSON.stringify(inputSchema);

    // Update script content on disk if provided
    if (script) {
      try {
        await fs.writeFile(toAbsolutePath(config.scriptPath), script as string, "utf-8");
      } catch (err) {
        return { success: false, output: null, error: `Failed to write script: ${(err as Error).message}` };
      }
    }

    if (Object.keys(dbUpdates).length === 0 && !script) {
      return {
        success: false,
        output: null,
        error: "At least one field to update is required (description, script, or inputSchema)",
      };
    }

    if (Object.keys(dbUpdates).length > 0) {
      await prisma.tool.update({ where: { id: tool.id }, data: dbUpdates });
    }

    return {
      success: true,
      output: { name: tool.name, message: `Plugin "${tool.name}" updated` },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
};
