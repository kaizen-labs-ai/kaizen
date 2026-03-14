import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import type {
  ToolExecutorFn,
  ToolExecutionResult,
  ContextualToolExecutorFn,
} from "../types";
import { createSkill, updateSkill, getAllSkills, updateSkillSubSkills, updateSkillTools } from "@/lib/skills/registry";
import {
  getRunArtifactsDir,
  getSkillDir,
  resolveArtifactPath,
  toAbsolutePath,
  toRelativePath,
  guessMimeType,
} from "@/lib/workspace";
import {
  getElasticMeta,
  resolveNextPhase,
  validateTransition,
  type AdvancePhaseContext,
} from "@/lib/agent/elastic-registry";

// ── Re-exports from split modules ────────────────────────
export {
  createPluginExecutorFactory,
  installPluginDepsExecutor,
  listPluginsExecutor,
  editPluginExecutor,
} from "./plugin-tools";

export {
  readUserMemoryExecutor,
  writeUserMemoryExecutor,
  writeToolMemoryExecutor,
  writeContactMemoryExecutorFactory,
} from "./memory-tools";

// ── Shared helpers for skill tools ────────────────────────

/** Resolve sub-skill names to IDs and link them to a skill. */
async function linkSubSkills(skillId: string, subSkillNames: string[]): Promise<string[]> {
  if (!subSkillNames.length) return [];
  const allSkills = await getAllSkills();
  const linked: string[] = [];
  const notFound: string[] = [];
  const subSkillData: Array<{ childSkillId: string; position: number; role: string }> = [];

  for (const name of subSkillNames) {
    const match = allSkills.find(
      (s) => s.name.toLowerCase() === name.toLowerCase() && s.id !== skillId
    );
    if (match) {
      subSkillData.push({ childSkillId: match.id, position: subSkillData.length, role: "" });
      linked.push(match.name);
    } else {
      notFound.push(name);
    }
  }

  if (subSkillData.length > 0) {
    await updateSkillSubSkills(skillId, subSkillData);
  }
  return notFound;
}

/**
 * Copy files from workspace paths into a skill's attachment directory.
 * When `replace` is true, removes all existing attachments first (for edit-skill).
 */
async function linkAttachments(
  skillId: string,
  attachmentPaths: string[],
  replace = false,
): Promise<{ linked: string[]; notFound: string[] }> {
  const linked: string[] = [];
  const notFound: string[] = [];
  const skillDir = await getSkillDir(skillId);

  // In replace mode, clear old attachments (files + DB records) before adding new ones
  if (replace) {
    const existing = await prisma.skillAttachment.findMany({ where: { skillId } });
    for (const att of existing) {
      try {
        await fs.unlink(path.join(skillDir, path.basename(att.filename)));
      } catch { /* file may already be gone */ }
    }
    await prisma.skillAttachment.deleteMany({ where: { skillId } });
  }

  for (const rawPath of attachmentPaths) {
    try {
      const absPath = toAbsolutePath(rawPath);
      await fs.access(absPath);
      const filename = path.basename(absPath);
      const destPath = path.join(skillDir, filename);
      await fs.copyFile(absPath, destPath);
      const stats = await fs.stat(destPath);
      const mimeType = guessMimeType(filename);

      // Replace existing attachment with same filename (for create-skill / additive mode)
      if (!replace) {
        const dup = await prisma.skillAttachment.findFirst({
          where: { skillId, filename },
        });
        if (dup) {
          await prisma.skillAttachment.delete({ where: { id: dup.id } });
        }
      }

      await prisma.skillAttachment.create({
        data: {
          skillId,
          filename,
          diskPath: toRelativePath(destPath),
          mimeType,
          sizeBytes: stats.size,
        },
      });
      linked.push(filename);
    } catch {
      notFound.push(rawPath);
    }
  }

  return { linked, notFound };
}

/** Replace all guardrails on a skill with new ones. */
async function replaceGuardrails(
  skillId: string,
  guardrails: Array<{ rule: string; type: string }>,
) {
  await prisma.guardrail.deleteMany({ where: { skillId } });
  if (guardrails.length > 0) {
    await prisma.guardrail.createMany({
      data: guardrails.map((g) => ({
        skillId,
        rule: g.rule,
        type: g.type,
        editableBy: "both",
      })),
    });
  }
}

/** Resolve tool/plugin names to IDs and link them to a skill (informational, not restrictive). */
async function linkToolsByName(
  skillId: string,
  toolNames: string[],
  toolType: "system" | "plugin",
): Promise<{ linked: string[]; notFound: string[] }> {
  if (!toolNames.length) return { linked: [], notFound: [] };
  const allTools = await prisma.tool.findMany({
    where: { enabled: true, type: toolType },
  });
  const linked: string[] = [];
  const notFound: string[] = [];
  const toolIds: string[] = [];

  for (const name of toolNames) {
    const match = allTools.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (match) {
      toolIds.push(match.id);
      linked.push(match.name);
    } else {
      notFound.push(name);
    }
  }

  if (toolIds.length > 0) {
    await updateSkillTools(skillId, toolIds, toolType);
  }
  return { linked, notFound };
}

/**
 * Auto-sync linked resources (tools, plugins, sub-skills) by scanning instruction
 * text for known names. Called when instructions are updated but the agent didn't
 * explicitly pass resource lists — keeps the resource panel in sync automatically.
 */
async function autoSyncResourcesFromInstructions(skillId: string, instructionText: string) {
  const textLower = instructionText.toLowerCase();

  // Auto-sync tools & plugins
  const allTools = await prisma.tool.findMany({ where: { enabled: true } });
  const matchedSystemIds: string[] = [];
  const matchedPluginIds: string[] = [];
  for (const t of allTools) {
    if (textLower.includes(t.name.toLowerCase())) {
      if (t.type === "system") matchedSystemIds.push(t.id);
      else if (t.type === "plugin") matchedPluginIds.push(t.id);
    }
  }
  await updateSkillTools(skillId, matchedSystemIds, "system");
  await updateSkillTools(skillId, matchedPluginIds, "plugin");

  // Auto-sync sub-skills
  const allSkills = await getAllSkills();
  const matchedSubSkills: Array<{ childSkillId: string; position: number; role: string }> = [];
  let pos = 0;
  for (const s of allSkills) {
    if (s.id === skillId) continue;
    if (textLower.includes(s.name.toLowerCase())) {
      matchedSubSkills.push({ childSkillId: s.id, position: pos++, role: "" });
    }
  }
  await updateSkillSubSkills(skillId, matchedSubSkills);
}

// ── create-skill ──────────────────────────────────────────

export const createSkillExecutor: ToolExecutorFn = async (
  input
): Promise<ToolExecutionResult> => {
  const { name, description, instructions, guardrails, subSkillNames, attachmentPaths, toolNames, pluginNames } = input;

  if (!name || !description || !instructions) {
    return {
      success: false,
      output: null,
      error: "name, description, and instructions are required",
    };
  }

  try {
    const skill = await createSkill({
      name: name as string,
      description: description as string,
      instructions: instructions as string,
      guardrails:
        (guardrails as Array<{ rule: string; type: string }>) ?? [],
    });

    const notes: string[] = [];

    // Link explicit resources or auto-sync from instructions
    const hasExplicitSubSkills = Array.isArray(subSkillNames) && subSkillNames.length > 0;
    const hasExplicitTools = Array.isArray(toolNames) && toolNames.length > 0;
    const hasExplicitPlugins = Array.isArray(pluginNames) && pluginNames.length > 0;
    const hasAnyExplicit = hasExplicitSubSkills || hasExplicitTools || hasExplicitPlugins;

    if (hasExplicitSubSkills) {
      const notFound = await linkSubSkills(skill.id, subSkillNames as string[]);
      if (notFound.length > 0) notes.push(`Sub-skills not found: ${notFound.join(", ")}`);
    }
    if (hasExplicitTools) {
      const result = await linkToolsByName(skill.id, toolNames as string[], "system");
      if (result.notFound.length > 0) notes.push(`Tools not found: ${result.notFound.join(", ")}`);
    }
    if (hasExplicitPlugins) {
      const result = await linkToolsByName(skill.id, pluginNames as string[], "plugin");
      if (result.notFound.length > 0) notes.push(`Plugins not found: ${result.notFound.join(", ")}`);
    }

    // When no explicit resource lists provided, auto-detect from instruction text
    if (!hasAnyExplicit) {
      await autoSyncResourcesFromInstructions(skill.id, instructions as string);
    }

    // Copy attachments into skill workspace
    if (Array.isArray(attachmentPaths) && attachmentPaths.length > 0) {
      const result = await linkAttachments(skill.id, attachmentPaths as string[]);
      if (result.linked.length > 0) {
        notes.push(`Attachments linked: ${result.linked.join(", ")}`);
      }
      if (result.notFound.length > 0) {
        notes.push(`Attachment paths not found: ${result.notFound.join(", ")}`);
      }
    }

    return {
      success: true,
      output: {
        id: skill.id,
        name: skill.name,
        message: `Skill "${skill.name}" created${notes.length ? ". " + notes.join(". ") : ""}`,
      },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
};

// ── edit-skill ───────────────────────────────────────────

export const editSkillExecutor: ToolExecutorFn = async (
  input
): Promise<ToolExecutionResult> => {
  const { id, name, description, instructions, guardrails, subSkillNames, attachmentPaths, toolNames, pluginNames } = input;

  if (!id) {
    return {
      success: false,
      output: null,
      error: "id is required. Use list-skills to find the skill ID first.",
    };
  }

  const updates: { name?: string; description?: string; instructions?: string } = {};
  if (name) updates.name = name as string;
  if (description) updates.description = description as string;
  if (instructions) updates.instructions = instructions as string;

  const hasGuardrails = Array.isArray(guardrails);
  const hasSubSkills = Array.isArray(subSkillNames) && subSkillNames.length > 0;
  const hasAttachments = Array.isArray(attachmentPaths) && attachmentPaths.length > 0;
  const hasTools = Array.isArray(toolNames) && toolNames.length > 0;
  const hasPlugins = Array.isArray(pluginNames) && pluginNames.length > 0;

  if (Object.keys(updates).length === 0 && !hasGuardrails && !hasSubSkills && !hasAttachments && !hasTools && !hasPlugins) {
    return {
      success: false,
      output: null,
      error: "At least one field to update is required (name, description, instructions, guardrails, subSkillNames, toolNames, pluginNames, or attachmentPaths)",
    };
  }

  try {
    let skill = Object.keys(updates).length > 0
      ? await updateSkill(id as string, updates)
      : await prisma.skill.findUniqueOrThrow({ where: { id: id as string } });

    const notes: string[] = [];

    // Replace guardrails
    if (hasGuardrails) {
      await replaceGuardrails(id as string, guardrails as Array<{ rule: string; type: string }>);
      notes.push(`Guardrails updated (${(guardrails as unknown[]).length})`);
    }

    // Link explicit resources or auto-sync from instructions
    const hasAnyExplicit = hasSubSkills || hasTools || hasPlugins;

    if (hasSubSkills) {
      const notFound = await linkSubSkills(id as string, subSkillNames as string[]);
      if (notFound.length > 0) notes.push(`Sub-skills not found: ${notFound.join(", ")}`);
    }
    if (hasTools) {
      const result = await linkToolsByName(id as string, toolNames as string[], "system");
      if (result.notFound.length > 0) notes.push(`Tools not found: ${result.notFound.join(", ")}`);
    }
    if (hasPlugins) {
      const result = await linkToolsByName(id as string, pluginNames as string[], "plugin");
      if (result.notFound.length > 0) notes.push(`Plugins not found: ${result.notFound.join(", ")}`);
    }

    // When instructions updated but no explicit resource lists, auto-detect from text
    if (instructions && !hasAnyExplicit) {
      await autoSyncResourcesFromInstructions(id as string, instructions as string);
    }

    // Copy attachments into skill workspace
    if (hasAttachments) {
      const result = await linkAttachments(id as string, attachmentPaths as string[], true);
      if (result.linked.length > 0) {
        notes.push(`Attachments linked: ${result.linked.join(", ")}`);
      }
      if (result.notFound.length > 0) {
        notes.push(`Attachment paths not found: ${result.notFound.join(", ")}`);
      }
    }

    return {
      success: true,
      output: {
        id: id as string,
        name: (skill as { name: string }).name,
        message: `Skill "${(skill as { name: string }).name}" updated${notes.length ? ". " + notes.join(". ") : ""}`,
      },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
};

// ── save-result (contextual — needs runId) ────────────────

export const saveResultExecutorFactory: ContextualToolExecutorFn = (ctx) => {
  return async (input): Promise<ToolExecutionResult> => {
    const { data, summary } = input;

    if (!data || !summary) {
      return {
        success: false,
        output: null,
        error: "data and summary are required",
      };
    }

    try {
      // Note: the "result" step is created by the orchestrator (callAgent)
      // via recordStep() after save-result succeeds, so it flows through SSE.
      // We do NOT create a DB step here to avoid duplicates.

      // Write result to workspace as a JSON artifact
      try {
        const resultFilename = `result_${Date.now()}.json`;
        const runDir = await getRunArtifactsDir(ctx.runId);
        const resultPath = resolveArtifactPath(runDir, resultFilename);
        await fs.writeFile(resultPath, JSON.stringify(data, null, 2), "utf-8");
        const fileStats = await fs.stat(resultPath);

        await prisma.artifact.create({
          data: {
            runId: ctx.runId,
            filename: resultFilename,
            diskPath: toRelativePath(resultPath),
            mimeType: "application/json",
            sizeBytes: fileStats.size,
            category: "result",
            intermediate: true,
            summary: summary as string,
          },
        });
      } catch {
        // Best-effort — Step record is the primary storage
      }

      return {
        success: true,
        output: { message: "Result saved", summary },
      };
    } catch (err) {
      return { success: false, output: null, error: (err as Error).message };
    }
  };
};

// ── advance-phase (contextual — needs objectiveId) ────────

const VALID_PHASES = ["discovery", "planning", "executing", "reviewing", "complete"];

// Phase ordering for forward-only validation
const PHASE_ORDER: Record<string, number> = {
  triage: 0,
  discovery: 1,
  planning: 2,
  executing: 3,
  reviewing: 4,
  complete: 5,
};

export const advancePhaseExecutorFactory: ContextualToolExecutorFn = (ctx) => {
  return async (input): Promise<ToolExecutionResult> => {
    let { phase } = input;
    const { summary } = input;

    try {
      const objective = await prisma.objective.findUniqueOrThrow({
        where: { id: ctx.objectiveId },
      });
      const currentPhase = objective.phase ?? "triage";
      const agent = ctx.agentId ?? "executor";

      // ── Smart routing: if no phase provided, auto-determine ──
      if (!phase) {
        let objConfig: Record<string, unknown> = {};
        try { objConfig = JSON.parse(objective.config || "{}"); } catch { /* ignore */ }

        const advCtx: AdvancePhaseContext = {
          currentPhase,
          agentId: agent,
          complexity: (objConfig.complexity as "simple" | "complex" | "image_generation") ?? "simple",
        };
        phase = resolveNextPhase(advCtx);
      }

      // ── Validate phase value ──
      if (!VALID_PHASES.includes(phase as string)) {
        return {
          success: false,
          output: null,
          error: `Invalid phase. Must be one of: ${VALID_PHASES.join(", ")}`,
        };
      }

      // ── Forward-only enforcement (reviewer sendback is the exception) ──
      const currentOrder = PHASE_ORDER[currentPhase] ?? 0;
      const targetOrder = PHASE_ORDER[phase as string] ?? 0;
      const isReviewerSendback = currentPhase === "reviewing" && phase === "executing";

      if (targetOrder < currentOrder && !isReviewerSendback) {
        return {
          success: false,
          output: null,
          error: `Cannot regress from "${currentPhase}" to "${phase}". Phase transitions must go forward.`,
        };
      }

      // ── Per-agent transition validation via elastic registry ──
      const validation = validateTransition(agent, currentPhase, phase as string);
      if (!validation.valid) {
        const meta = getElasticMeta(agent);
        const allowed = meta?.validTransitions[currentPhase];
        const hint = allowed?.length
          ? ` Valid targets from "${currentPhase}": ${allowed.join(", ")}. Or omit "phase" to auto-determine.`
          : "";
        return {
          success: false,
          output: null,
          error: `${validation.reason!}${hint}`,
        };
      }

      await prisma.objective.update({
        where: { id: ctx.objectiveId },
        data: { phase: phase as string },
      });

      return {
        success: true,
        output: {
          phase,
          summary: summary ?? null,
          message: `Phase updated to "${phase}"`,
        },
      };
    } catch (err) {
      return { success: false, output: null, error: (err as Error).message };
    }
  };
};

// ── list-skills ───────────────────────────────────────────

export const listSkillsExecutor: ToolExecutorFn = async (): Promise<ToolExecutionResult> => {
  try {
    const skills = await getAllSkills();
    return {
      success: true,
      output: {
        skills: skills.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          instructions: s.instructions,
        })),
      },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
};

// ── list-tools (contextual — filters by contact permissions) ──

export const listToolsExecutorFactory: ContextualToolExecutorFn = (ctx) => async (): Promise<ToolExecutionResult> => {
  try {
    const tools = await prisma.tool.findMany({
      where: { enabled: true },
      orderBy: { name: "asc" },
    });

    // Apply contact permission filtering so restricted tools aren't revealed
    let visibleTools = tools;
    if (ctx.contactId) {
      try {
        const { parsePermissions, filterToolsByPermissions } = await import("@/lib/extensions/contacts");
        const contact = await prisma.channelContact.findUnique({
          where: { id: ctx.contactId },
          select: { permissions: true, isSelf: true },
        });
        if (contact) {
          const permissions = parsePermissions(contact.permissions, contact.isSelf);
          visibleTools = filterToolsByPermissions(visibleTools, permissions);
          if (!permissions.pluginAccess) {
            visibleTools = visibleTools.filter((t) => t.type !== "plugin");
          }
        }
      } catch { /* best-effort — show all if lookup fails */ }
    }

    return {
      success: true,
      output: {
        tools: visibleTools.map((t) => ({
          name: t.name,
          description: t.description,
        })),
      },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
};

