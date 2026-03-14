import { prisma } from "@/lib/db/prisma";
import type { ToolExecutorFn, ContextualToolExecutorFn, ExecutionContext } from "./types";
import path from "node:path";
import { executePlugin, type PluginConfig } from "./plugin-executor";
import { toAbsolutePath } from "@/lib/workspace";
import { fileReadExecutor, fileWriteExecutorFactory } from "./builtin/file-tool";
import { downloadImageExecutorFactory } from "./builtin/download-image-tool";
import { webFetchExecutor } from "./builtin/web-fetch-tool";
import { runSnippetExecutorFactory } from "./builtin/run-snippet-tool";
import { context7ResolveExecutor, context7DocsExecutor } from "./builtin/context7-tool";
import { braveSearchExecutor, braveInstantExecutor, braveImageSearchExecutor, braveNewsSearchExecutor, braveVideoSearchExecutor } from "./builtin/brave-search-tool";
import { shadcnListComponentsExecutor, shadcnGetComponentDocsExecutor } from "./builtin/shadcn-tool";
import { useSecretExecutorFactory } from "./builtin/use-secret-tool";
import { createScheduleExecutor, listSchedulesExecutor, updateScheduleExecutor, deleteScheduleExecutor } from "./builtin/schedule-tools";
import {
  chromeNavigateExecutor,
  chromeSnapshotExecutor,
  chromeClickExecutor,
  chromeFillExecutor,
  chromeEvaluateExecutor,
  chromeWaitExecutor,
  chromeNewTabExecutor,
  chromeListTabsExecutor,
  chromeSelectTabExecutor,
} from "./builtin/chrome-devtools-tool";
import { skillDbSchemaExecutor, skillDbQueryExecutor, skillDbExecuteExecutor } from "./builtin/skill-db-tool";
import { readRunHistoryExecutorFactory } from "./builtin/run-history-tool";
import {
  createSkillExecutor,
  editSkillExecutor,
  saveResultExecutorFactory,
  advancePhaseExecutorFactory,
  listSkillsExecutor,
  listToolsExecutorFactory,
  createPluginExecutorFactory,
  installPluginDepsExecutor,
  listPluginsExecutor,
  editPluginExecutor,
  readUserMemoryExecutor,
  writeUserMemoryExecutor,
  writeContactMemoryExecutorFactory,
  writeToolMemoryExecutor,
} from "./builtin/self-management-tools";

// Simple executors (no context needed)
const builtinExecutors: Record<string, ToolExecutorFn> = {
  "file-read": fileReadExecutor,
  "web-fetch": webFetchExecutor,
  "create-skill": createSkillExecutor,
  "edit-skill": editSkillExecutor,
  "list-skills": listSkillsExecutor,
  "install-plugin-deps": installPluginDepsExecutor,
  "list-plugins": listPluginsExecutor,
  "edit-plugin": editPluginExecutor,
  "read-user-memory": readUserMemoryExecutor,
  "write-user-memory": writeUserMemoryExecutor,
  "write-tool-memory": writeToolMemoryExecutor,
  "context7-resolve": context7ResolveExecutor,
  "context7-docs": context7DocsExecutor,
  "chrome-navigate": chromeNavigateExecutor,
  "chrome-snapshot": chromeSnapshotExecutor,
  "chrome-click": chromeClickExecutor,
  "chrome-fill": chromeFillExecutor,
  "chrome-evaluate": chromeEvaluateExecutor,
  "chrome-wait": chromeWaitExecutor,
  "chrome-new-tab": chromeNewTabExecutor,
  "chrome-list-tabs": chromeListTabsExecutor,
  "chrome-select-tab": chromeSelectTabExecutor,
  "shadcn-list": shadcnListComponentsExecutor,
  "shadcn-docs": shadcnGetComponentDocsExecutor,
  "brave-search": braveSearchExecutor,
  "brave-instant": braveInstantExecutor,
  "brave-image-search": braveImageSearchExecutor,
  "brave-news-search": braveNewsSearchExecutor,
  "brave-video-search": braveVideoSearchExecutor,
  "skill-db-schema": skillDbSchemaExecutor,
  "skill-db-query": skillDbQueryExecutor,
  "skill-db-execute": skillDbExecuteExecutor,
  "create-schedule": createScheduleExecutor,
  "list-schedules": listSchedulesExecutor,
  "update-schedule": updateScheduleExecutor,
  "delete-schedule": deleteScheduleExecutor,
};

// Contextual executors (need objectiveId / runId)
const contextualExecutors: Record<string, ContextualToolExecutorFn> = {
  "file-write": fileWriteExecutorFactory,
  "save-result": saveResultExecutorFactory,
  "advance-phase": advancePhaseExecutorFactory,
  "create-plugin": createPluginExecutorFactory,
  "download-image": downloadImageExecutorFactory,
  "write-whatsapp-contact-memory": writeContactMemoryExecutorFactory,
  "list-tools": listToolsExecutorFactory,
  "use-secret": useSecretExecutorFactory,
  "read-run-history": readRunHistoryExecutorFactory,
  "run-snippet": runSnippetExecutorFactory,
};

export async function getToolExecutor(
  toolName: string,
  context?: ExecutionContext
): Promise<ToolExecutorFn | null> {
  // Check contextual executors first
  if (contextualExecutors[toolName]) {
    if (!context) {
      // Return a stub that errors — tool requires context
      return async () => ({
        success: false,
        output: null,
        error: `Tool "${toolName}" requires execution context`,
      });
    }
    return contextualExecutors[toolName](context);
  }

  // Check simple builtins
  if (builtinExecutors[toolName]) return builtinExecutors[toolName];

  // Dynamic zapier_* tools — routed to the generic Zapier executor
  // Defense-in-depth: wrap with vault secret scrubbing so the LLM never sees raw keys
  if (toolName.startsWith("zapier_")) {
    const { zapierToolExecutor } = await import("./builtin/zapier-tool");
    const { getSecret } = await import("@/lib/vault/vault");
    return async (input) => {
      const result = await zapierToolExecutor(input, toolName);
      const key = await getSecret("zapier_api_key");
      if (key && result.output) {
        const json = JSON.stringify(result.output);
        if (json.includes(key)) {
          result.output = JSON.parse(json.replaceAll(key, "[REDACTED]"));
        }
      }
      if (key && result.error?.includes(key)) {
        result.error = result.error.replaceAll(key, "[REDACTED]");
      }
      return result;
    };
  }

  // Check DB tools (single query with hyphen ↔ underscore normalization)
  const altToolName = toolName.includes("-")
    ? toolName.replace(/-/g, "_")
    : toolName.replace(/_/g, "-");
  const tool = await prisma.tool.findFirst({
    where: { name: { in: [toolName, altToolName] } },
  });
  if (!tool || !tool.enabled) return null;

  if (tool.type === "plugin") {
    const pluginConfig = JSON.parse(tool.config) as PluginConfig;
    // Set NODE_PATH so require() finds deps in the plugin's own node_modules
    if (pluginConfig.language === "node" || pluginConfig.language === "typescript") {
      const pluginDir = path.dirname(toAbsolutePath(pluginConfig.scriptPath));
      pluginConfig.nodePath = path.join(pluginDir, "node_modules");
    }
    return async (input) => executePlugin(pluginConfig, input, context);
  }

  return null;
}

export async function getAllTools() {
  return prisma.tool.findMany({ orderBy: { name: "asc" } });
}

export async function getEnabledTools() {
  return prisma.tool.findMany({ where: { enabled: true }, orderBy: { name: "asc" } });
}

export async function getToolsForSkill(skillId: string) {
  const skillTools = await prisma.skillTool.findMany({
    where: { skillId },
    include: { tool: true },
  });
  return skillTools.map((st) => st.tool).filter((t) => t.enabled);
}
