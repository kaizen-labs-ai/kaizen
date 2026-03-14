import { prisma } from "@/lib/db/prisma";
import { toAbsolutePath } from "@/lib/workspace";
import { promises as fs } from "node:fs";

export interface PluginListItem {
  id: string;
  name: string;
  description: string;
  language: string;
  scriptPath: string;
  timeout: number;
  dependencies: string[];
  enabled: boolean;
  createdBy: string | null;
  createdAt: Date;
}

/** Returns all plugins with parsed config fields. */
export async function getAllPlugins(): Promise<PluginListItem[]> {
  const plugins = await prisma.tool.findMany({
    where: { type: "plugin" },
    orderBy: { createdAt: "desc" },
  });

  return plugins.map((p) => {
    const config = JSON.parse(p.config) as {
      language: string;
      scriptPath: string;
      timeout?: number;
      dependencies?: string[];
    };
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      language: config.language,
      scriptPath: config.scriptPath,
      timeout: config.timeout ?? 60000,
      dependencies: config.dependencies ?? [],
      enabled: p.enabled,
      createdBy: p.createdBy,
      createdAt: p.createdAt,
    };
  });
}

export interface PluginDetail {
  id: string;
  name: string;
  description: string;
  language: string;
  scriptPath: string;
  absolutePath: string;
  timeout: number;
  dependencies: string[];
  enabled: boolean;
  createdBy: string | null;
  createdAt: Date;
  scriptContent: string;
  inputSchema: {
    type: string;
    properties?: Record<string, { type?: string; description?: string; default?: unknown }>;
    required?: string[];
  } | null;
}

/** Returns a single plugin with parsed config + script content from disk. */
export async function getPluginDetail(id: string): Promise<PluginDetail | null> {
  const tool = await prisma.tool.findUnique({ where: { id } });
  if (!tool || tool.type !== "plugin") return null;

  const config = JSON.parse(tool.config) as {
    language: string;
    scriptPath: string;
    timeout?: number;
    dependencies?: string[];
  };

  let scriptContent = "";
  try {
    scriptContent = await fs.readFile(toAbsolutePath(config.scriptPath), "utf-8");
  } catch {
    scriptContent = "// Script file not found on disk";
  }

  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    language: config.language,
    scriptPath: config.scriptPath,
    absolutePath: toAbsolutePath(config.scriptPath),
    timeout: config.timeout ?? 60000,
    dependencies: config.dependencies ?? [],
    enabled: tool.enabled,
    createdBy: tool.createdBy,
    createdAt: tool.createdAt,
    scriptContent,
    inputSchema: tool.inputSchema ? JSON.parse(tool.inputSchema) : null,
  };
}
