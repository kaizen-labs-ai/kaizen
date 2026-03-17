import { prisma } from "@/lib/db/prisma";
import path from "node:path";
import { promises as fs } from "node:fs";

export async function createSkill(data: {
  name: string;
  description: string;
  instructions: string;
  modelPref?: string | null;
  toolIds?: string[];
  vaultEntryIds?: string[];
  guardrails?: Array<{ rule: string; type: string; editableBy?: string }>;
}) {
  return prisma.skill.create({
    data: {
      name: data.name,
      description: data.description,
      instructions: data.instructions,
      modelPref: data.modelPref,
      tools: {
        create: (data.toolIds ?? []).map((toolId) => ({ toolId })),
      },
      vaultEntries: {
        create: (data.vaultEntryIds ?? []).map((vaultEntryId) => ({ vaultEntryId })),
      },
      guardrails: {
        create: (data.guardrails ?? []).map((g) => ({
          rule: g.rule,
          type: g.type,
          editableBy: g.editableBy ?? "both",
        })),
      },
    },
    include: {
      tools: { include: { tool: true } },

      vaultEntries: { include: { vaultEntry: true } },
      guardrails: true,
    },
  });
}

export async function getSkillWithDetails(id: string) {
  return prisma.skill.findUnique({
    where: { id },
    include: {
      tools: { include: { tool: true } },
      vaultEntries: { include: { vaultEntry: true } },
      guardrails: { orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { createdAt: "asc" } },
      subSkills: {
        include: { childSkill: { select: { id: true, name: true, description: true } } },
        orderBy: { position: "asc" },
      },
    },
  });
}

/** Returns only enabled skills — used by orchestrator, prompt builder, and tools. */
export async function getAllSkills() {
  return prisma.skill.findMany({
    where: { enabled: true },
    include: {
      guardrails: true,
      tools: { include: { tool: true } },

      vaultEntries: { include: { vaultEntry: true } },
      attachments: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Returns all skills including disabled — used by the UI. */
export async function getAllSkillsAdmin() {
  return prisma.skill.findMany({
    include: {
      guardrails: true,
      tools: { include: { tool: true } },

      vaultEntries: { include: { vaultEntry: true } },
      attachments: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateSkill(
  id: string,
  data: {
    name?: string;
    description?: string;
    instructions?: string;
    modelPref?: string | null;
    enabled?: boolean;
  }
) {
  return prisma.skill.update({
    where: { id },
    data,
    include: { tools: { include: { tool: true } }, guardrails: true, attachments: true },
  });
}

export async function updateSkillTools(skillId: string, toolIds: string[], toolType?: "system" | "plugin" | "non-plugin") {
  if (toolType) {
    // Type-aware: only delete SkillTool records whose tool matches the given type
    const existing = await prisma.skillTool.findMany({
      where: { skillId },
      include: { tool: { select: { type: true } } },
    });
    const toDelete = existing.filter((st) =>
      toolType === "non-plugin" ? st.tool.type !== "plugin" : st.tool.type === toolType
    ).map((st) => st.id);
    if (toDelete.length > 0) {
      await prisma.skillTool.deleteMany({ where: { id: { in: toDelete } } });
    }
  } else {
    await prisma.skillTool.deleteMany({ where: { skillId } });
  }
  if (toolIds.length > 0) {
    await prisma.skillTool.createMany({
      data: toolIds.map((toolId) => ({ skillId, toolId })),
    });
  }
  return getSkillWithDetails(skillId);
}

export async function updateSkillVaultEntries(skillId: string, vaultEntryIds: string[]) {
  await prisma.skillVaultEntry.deleteMany({ where: { skillId } });
  if (vaultEntryIds.length > 0) {
    await prisma.skillVaultEntry.createMany({
      data: vaultEntryIds.map((vaultEntryId) => ({ skillId, vaultEntryId })),
    });
  }
  return getSkillWithDetails(skillId);
}

export async function updateSkillSubSkills(
  skillId: string,
  subSkills: Array<{ childSkillId: string; position: number; role: string }>
) {
  await prisma.skillSubSkill.deleteMany({ where: { parentSkillId: skillId } });
  if (subSkills.length > 0) {
    await prisma.skillSubSkill.createMany({
      data: subSkills.map((s) => ({
        parentSkillId: skillId,
        childSkillId: s.childSkillId,
        position: s.position,
        role: s.role,
      })),
    });
  }
  return getSkillWithDetails(skillId);
}

export async function deleteSkill(id: string) {
  // Clean up attachment files from disk (best-effort)
  const skillDir = path.join(process.cwd(), "workspace", "skills", id);
  await fs.rm(skillDir, { recursive: true, force: true }).catch(() => {});
  return prisma.skill.delete({ where: { id } });
}

// ── Skill matching ───────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "as",
  "into", "about", "between", "through", "during", "before", "after",
  "and", "but", "or", "nor", "not", "no", "so", "if", "then",
  "it", "its", "this", "that", "these", "those",
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "they",
  "what", "which", "who", "whom", "how", "when", "where", "why",
  "do", "does", "did", "have", "has", "had", "will", "would", "can", "could",
  "should", "may", "might", "shall", "must",
  "get", "got", "let", "make", "just", "also", "very", "really",
  "current", "currently", "please", "tell", "give", "show",
]);

// Pre-compiled tokenization regexes (avoid recompilation on every tokenize call)
const CAMEL_CASE_RE = /([a-z])([A-Z])/g;
const SEPARATOR_RE = /[_\-./]/g;
const NON_ALNUM_RE = /[^a-z0-9]/g;

function tokenize(text: string): string[] {
  CAMEL_CASE_RE.lastIndex = 0;
  SEPARATOR_RE.lastIndex = 0;
  return text
    .replace(CAMEL_CASE_RE, "$1 $2") // split camelCase
    .replace(SEPARATOR_RE, " ")       // split snake_case, kebab, paths
    .toLowerCase()
    .split(/\s+/)
    .map((w) => {
      NON_ALNUM_RE.lastIndex = 0;
      return w.replace(NON_ALNUM_RE, "");
    })
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

const MATCH_THRESHOLD = 0.3;

/**
 * Finds the best-matching skill for a given objective by keyword overlap.
 * Returns the skill ID if a match exceeds the threshold, otherwise null.
 */
export async function matchSkillForObjective(
  title: string,
  description: string
): Promise<string | null> {
  const skills = await getAllSkills();
  if (skills.length === 0) return null;

  const objectiveTokens = tokenize(`${title} ${description}`);
  if (objectiveTokens.length === 0) return null;

  const objectiveSet = new Set(objectiveTokens);

  let bestId: string | null = null;
  let bestScore = 0;

  for (const skill of skills) {
    const skillTokens = new Set(
      tokenize(`${skill.name} ${skill.description}`)
    );

    let overlap = 0;
    for (const word of objectiveSet) {
      if (skillTokens.has(word)) overlap++;
    }

    const score = overlap / objectiveSet.size;
    if (score > bestScore) {
      bestScore = score;
      bestId = skill.id;
    }
  }

  return bestScore >= MATCH_THRESHOLD ? bestId : null;
}
