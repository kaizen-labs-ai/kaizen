import { getActiveSoul } from "./soul";
import { getUserMemory } from "@/lib/memory/user-memory";
import { getSkillWithDetails, getAllSkills } from "@/lib/skills/registry";
import { getSetting } from "@/lib/settings/registry";
import { THEME_DEVELOPER_INSTRUCTIONS } from "@/lib/agents/theme-kit";
import { prisma } from "@/lib/db/prisma";
import type { RunContactProfile, ContactPermissions } from "@/lib/extensions/contacts";
import { filterToolsByPermissions } from "@/lib/extensions/contacts";

// Pre-compiled placeholder regex (avoids recompilation on every buildSystemPrompt call)
const PHASE_PLACEHOLDER_RE = /\{\{phase\}\}/g;

interface PromptContext {
  agentId?: string;
  skillId?: string | null;
  /** When true, inject skill as context (name, attachments) but NOT as mandatory instructions */
  skillContextOnly?: boolean;
  phase?: string;
  workingMemory?: string;
  objectiveContext?: string;
  systemInstructions?: string;
  contactProfile?: RunContactProfile;
}

// ── Per-run environment context cache ───────────────────────────
// Tools, plugins, skills, and agents don't change mid-run. Cache the
// result so we don't re-query 3 tables on every agent transition.
let _envCacheKey: string | null = null;
let _envCacheValue: string = "";

/** Clear the environment context cache. Call at the start of each run. */
export function clearEnvironmentCache() {
  _envCacheKey = null;
  _envCacheValue = "";
}

/**
 * Build a compact environment summary: tools, plugins, skills, agents.
 * Used by both the executor system prompt and the conversational path.
 */
export async function buildEnvironmentContext(permissions?: ContactPermissions, agentId?: string): Promise<string> {
  // Cache key based on permission fingerprint + agent (same combo = same result)
  const cacheKey = (permissions ? JSON.stringify(permissions) : "__default__") + (agentId ?? "");
  if (_envCacheKey === cacheKey) return _envCacheValue;

  const sections: string[] = [];

  // Tools (builtin system tools — exclude plugins, they're listed separately)
  const tools = await prisma.tool.findMany({
    where: { enabled: true },
    orderBy: { name: "asc" },
  });
  let builtinTools = tools.filter((t) => t.type === "system");
  let pluginTools = tools.filter((t) => t.type === "plugin");

  // Filter tools by contact permissions so restricted tools aren't even mentioned
  if (permissions) {
    builtinTools = filterToolsByPermissions(builtinTools, permissions);
    if (!permissions.pluginAccess) {
      pluginTools = []; // Hide all plugins
    }
  }

  // Executor already has detailed tool guidance in its system instructions —
  // skip the DB tool descriptions to avoid duplication and conflicting advice.
  // Conversational agent doesn't have that, so it still gets the list.
  if (builtinTools.length > 0 && agentId !== "executor") {
    sections.push(
      "## Tools\n" +
        builtinTools.map((t) => `- **${t.name}**: ${t.description}`).join("\n")
    );
  }

  // Plugins (custom executable scripts that are also callable tools)
  if (pluginTools.length > 0) {
    sections.push(
      "## Plugins\n" +
        pluginTools.map((p) => `- **${p.name}**: ${p.description}`).join("\n")
    );
  }

  // Zapier integrations (MCP tools from connected apps)
  const zapierTools = tools.filter((t) => t.type === "mcp" && t.name.startsWith("zapier_") && t.name !== "zapier_get_configuration_url");
  if (permissions && !permissions.extensionAccess) {
    // Hide Zapier tools when extension access is off
  } else if (zapierTools.length > 0) {
    // Group by app name for a concise summary
    const appMap = new Map<string, string[]>();
    for (const t of zapierTools) {
      try {
        const config = JSON.parse(t.config) as { appName?: string };
        const app = config.appName ?? "Other";
        if (!appMap.has(app)) appMap.set(app, []);
        appMap.get(app)!.push(t.name);
      } catch {
        const fallback = "Other";
        if (!appMap.has(fallback)) appMap.set(fallback, []);
        appMap.get(fallback)!.push(t.name);
      }
    }
    const appLines = Array.from(appMap.entries()).map(
      ([app, names]) => `- **${app}** (${names.length} actions): ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", ..." : ""}`
    );
    sections.push(
      "## Zapier Integrations (connected apps)\n" +
        "ONLY these external services are currently connected via Zapier. If a service is NOT listed here, the user must add it via Extensions > Zapier before you can use it.\n" +
        "Do NOT create skills that reference Zapier tools for services not listed below — they will fail.\n" +
        appLines.join("\n")
    );
  }

  // Skills (reusable automations) — hidden when skillAccess is off
  if (!permissions || permissions.skillAccess !== false) {
    const skills = await getAllSkills();
    if (skills.length > 0) {
      sections.push(
        "## Skills\n" +
          skills.map((s) => `- **${s.name}**: ${s.description}`).join("\n")
      );
    }
  }

  // Agents list removed — executor/conversational don't need to know about
  // internal agent roles and models. This saves ~300 tokens per run.

  if (sections.length === 0) {
    _envCacheKey = cacheKey;
    _envCacheValue = "";
    return "";
  }
  const result = `# Environment\n\n${sections.join("\n\n")}`;
  _envCacheKey = cacheKey;
  _envCacheValue = result;
  return result;
}

export async function buildSystemPrompt(ctx: PromptContext): Promise<string> {
  const parts: string[] = [];

  const isUserFacing = ctx.agentId === "executor" || ctx.agentId === "planner" || ctx.agentId === "reviewer" || ctx.agentId === "developer";
  const needsSoul = isUserFacing && !ctx.contactProfile?.customSoul;
  const memoryAllowed = ctx.contactProfile?.permissions?.memoryAccess !== false;

  // ── Fire all independent DB queries in parallel ──────────────────
  const [contactSoul, activeSoul, themeEnabled, skill, userMemory, envContext] = await Promise.all([
    needsSoul && ctx.contactProfile?.soulId
      ? prisma.soul.findUnique({ where: { id: ctx.contactProfile.soulId } })
      : null,
    needsSoul ? getActiveSoul() : null,
    ctx.agentId === "developer" ? getSetting("theme_kit_enabled", "true") : null,
    ctx.skillId ? getSkillWithDetails(ctx.skillId) : null,
    memoryAllowed ? getUserMemory() : null,
    ctx.agentId === "executor" ? buildEnvironmentContext(ctx.contactProfile?.permissions, ctx.agentId) : null,
  ]);

  // ── Assemble parts in order ─────────────────────────────────────

  // 1. Soul — injected into user-facing agents
  if (isUserFacing) {
    if (ctx.contactProfile?.customSoul) {
      parts.push(`# Personality\n\nAdopt this personality in all your responses to the user:\n\n${ctx.contactProfile.customSoul}`);
    } else {
      const soul = contactSoul ?? activeSoul;
      if (soul) {
        parts.push(`# Personality\n\nAdopt this personality in all your responses to the user:\n\n${soul.traits}`);
      }
    }
  }

  // 1b. Theme Kit — inject theme CSS/instructions for developer
  if (ctx.agentId === "developer" && themeEnabled === "true") {
    parts.push(THEME_DEVELOPER_INSTRUCTIONS);
  }

  // 2. Skill instructions + guardrails
  if (skill) {
      if (ctx.skillContextOnly) {
        // Context-only mode: provide skill name, ID, and what it does, but do NOT
        // inject the step-by-step instructions. The executor should answer the
        // user's actual question, not re-execute the skill workflow.
        // Include the skill ID so the agent can self-correct via edit-skill.
        parts.push(
          `# Related Skill: ${skill.name} (ID: ${skill.id})\n\n` +
          `This skill was used in the conversation. Its purpose: ${skill.instructions.split("\n").slice(0, 3).join(" ").substring(0, 200)}...\n\n` +
          `**You are NOT executing this skill.** The user is asking a follow-up question about the approach, method, or results. Answer their actual question using your tools. Do NOT follow the skill's step-by-step instructions.`
        );
      } else {
        parts.push(`# Current Skill: ${skill.name}\n\n## Instructions\n${skill.instructions}`);
      }

      if (!ctx.skillContextOnly && skill.guardrails.length > 0) {
        const guardrailText = skill.guardrails
          .map((g) => {
            const prefix =
              g.type === "must"
                ? "MUST"
                : g.type === "must_not"
                  ? "MUST NOT"
                  : "LIMIT";
            return `- [${prefix}] ${g.rule}`;
          })
          .join("\n");
        parts.push(`## Guardrails\n${guardrailText}`);
      }

      // Sub-skills — tell the agent what child skills are available
      if (!ctx.skillContextOnly && skill.subSkills && skill.subSkills.length > 0) {
        const subSkillLines = skill.subSkills.map((ss: { role: string; childSkill: { name: string; description: string } }) => {
          const child = ss.childSkill;
          const roleText = ss.role ? ` — ${ss.role}` : "";
          return `- **${child.name}**: ${child.description}${roleText}`;
        }).join("\n");
        parts.push(
          `## Sub-skills\nThe following sub-skills are available within this skill. You can invoke them by name when their capability is needed:\n` +
          subSkillLines
        );
      }

      // Linked tools/plugins — informational hints (not restrictive)
      if (!ctx.skillContextOnly && skill.tools && skill.tools.length > 0) {
        const systemTools = (skill.tools as { tool: { name: string; type: string; description: string } }[])
          .filter((st) => st.tool.type === "system")
          .map((st) => `- **${st.tool.name}**: ${st.tool.description}`);
        const pluginTools = (skill.tools as { tool: { name: string; type: string; description: string } }[])
          .filter((st) => st.tool.type === "plugin")
          .map((st) => `- **${st.tool.name}**: ${st.tool.description}`);
        const lines: string[] = [];
        if (systemTools.length > 0) lines.push("**Tools:**\n" + systemTools.join("\n"));
        if (pluginTools.length > 0) lines.push("**Plugins:**\n" + pluginTools.join("\n"));
        if (lines.length > 0) {
          parts.push(
            `## Recommended Tools\nThe following tools/plugins are linked to this skill as recommended resources. You are NOT restricted to only these — use any available tool if needed.\n` +
            lines.join("\n\n")
          );
        }
      }

      // Always include attachments — they're useful reference even in context-only mode
      if (skill.attachments && skill.attachments.length > 0) {
        const attachmentList = skill.attachments
          .map((a) => `- ${a.filename} (${a.mimeType}) — path: ${a.diskPath}`)
          .join("\n");
        parts.push(`## Skill Attachments\nThe following reference files are attached to this skill and available on disk:\n${attachmentList}`);
      }

      // Skill database — always tell the agent the correct skillId for db tools
      if (skill.id) {
        const { skillDbExists, getSkillDbTables } = await import("@/lib/skills/skill-db");
        if (skillDbExists(skill.id)) {
          const tables = getSkillDbTables(skill.id);
          if (tables.length > 0) {
            const tableDescriptions = tables.map((t) => {
              const cols = t.columns.map((c) => `${c.name} (${c.type}${c.pk ? ", PK" : ""})`).join(", ");
              return `- **${t.name}** [${t.rowCount} rows]: ${cols}`;
            }).join("\n");
            parts.push(
              `## Skill Database\nThis skill has a persistent SQLite database with the following tables:\n${tableDescriptions}\n\n**CRITICAL: Use these EXACT table and column names.** Do NOT create new tables if a suitable one already exists. Use skill-db-query({ skillId: "${skill.id}", sql: "..." }) to read data and skill-db-execute({ skillId: "${skill.id}", sql: "..." }) to write data.`
            );
          } else {
            parts.push(
              `## Skill Database\nThis skill has a persistent SQLite database but no tables yet. Use skill-db-execute({ skillId: "${skill.id}", sql: "CREATE TABLE ..." }) to create tables, and always name timestamp columns "created_at".`
            );
          }
        } else {
          // DB doesn't exist yet — still tell the agent the correct skillId so it uses the right path
          parts.push(
            `## Skill Database\nThis skill has no database yet. When the skill instructions reference skill-db tools, use skillId: "${skill.id}" — for example: skill-db-execute({ skillId: "${skill.id}", sql: "CREATE TABLE ..." }). Always name timestamp columns "created_at".`
          );
        }
      }

      // Linked vault secrets — tell the agent what's available and how to use them
      if (skill.vaultEntries && skill.vaultEntries.length > 0) {
        const secretLines: string[] = [];
        for (const sve of skill.vaultEntries as { vaultEntry: { label: string; category: string } }[]) {
          const ve = sve.vaultEntry;
          if (ve.category === "login") {
            secretLines.push(
              `- **${ve.label}** (login) — has username + password. Use TWO calls:\n` +
              `  - Username: \`use-secret({ secretLabel: "${ve.label}", action: "fill", field: "username", target: "<uid>" })\`\n` +
              `  - Password: \`use-secret({ secretLabel: "${ve.label}", action: "fill", field: "password", target: "<uid>" })\``
            );
          } else if (ve.category === "password") {
            secretLines.push(`- **${ve.label}** (password) — use: \`use-secret({ secretLabel: "${ve.label}", action: "fill", target: "<uid>" })\``);
          } else if (ve.category === "api_key" || ve.category === "token") {
            secretLines.push(`- **${ve.label}** (${ve.category}) — use: \`use-secret({ secretLabel: "${ve.label}", action: "header", target: "Authorization" })\``);
          } else if (ve.category === "address") {
            secretLines.push(
              `- **${ve.label}** (address) — use field param to fill individual fields:\n` +
              `  \`use-secret({ secretLabel: "${ve.label}", action: "fill", field: "first_name"|"last_name"|"street"|"city"|"state"|"zip"|"country"|"phone", target: "<uid>" })\``
            );
          } else {
            secretLines.push(`- **${ve.label}** (${ve.category}) — use: \`use-secret({ secretLabel: "${ve.label}", action: "value" })\``);
          }
        }
        parts.push(
          `## Available Secrets\n` +
          `The following vault secrets are linked to this skill. Use the \`use-secret\` tool to apply them — NEVER type or paste secret values directly.\n` +
          secretLines.join("\n")
        );
      }
  }

  // 3. User memory (pre-fetched above)
  if (userMemory) {
    parts.push(`# User Context\n\n${userMemory}`);
  }

  // 4. Working memory (per-objective, passed in)
  if (ctx.workingMemory) {
    parts.push(
      `# Working Memory (from previous runs)\n\n${ctx.workingMemory}`
    );
  }

  // 5. Objective context (for follow-up runs, so the LLM knows the goal)
  if (ctx.objectiveContext) {
    parts.push(`# Current Objective\n\n${ctx.objectiveContext}`);
  }

  // 6. System instructions (from agent config — coordinator always provides this)
  if (ctx.systemInstructions) {
    const phase = ctx.phase ?? "triage";
    PHASE_PLACEHOLDER_RE.lastIndex = 0;
    const rendered = ctx.systemInstructions.replace(
      PHASE_PLACEHOLDER_RE,
      phase
    );
    parts.push(`# System Instructions\n\n${rendered}`);
  }

  // 7. Contact memory — used when personal memory access is off (mutually exclusive)
  if (ctx.contactProfile?.permissions?.memoryAccess === false && ctx.contactProfile?.instructions) {
    parts.push(`# Contact Memory\n\nWhat you know about this contact:\n\n${ctx.contactProfile.instructions}`);
  }

  // 8. Permission restrictions — tell the agent what it CANNOT do so it declines gracefully
  if (ctx.contactProfile?.permissions) {
    const restrictions = buildRestrictions(ctx.contactProfile.permissions);
    if (restrictions) {
      parts.push(restrictions);
    }
  }

  // 9. Environment context (pre-fetched above, for executor)
  if (envContext) {
    parts.push(envContext);
  }

  return parts.join("\n\n---\n\n");
}

/**
 * Build a restrictions block that tells the agent what it cannot do.
 * Only generates output when at least one permission is OFF.
 */
function buildRestrictions(permissions: ContactPermissions): string | null {
  const denied: string[] = [];

  if (!permissions.memoryAccess) {
    denied.push("- Access the owner's personal memory or personal information");
  }
  if (!permissions.webAccess) {
    denied.push("- Search the web or fetch URLs");
  }
  if (!permissions.extensionAccess) {
    denied.push("- Use extensions (Brave Search, Zapier, or other integrations)");
  }
  if (!permissions.pluginAccess) {
    denied.push("- Create, edit, or run plugins");
  }
  if (!permissions.codeExecution) {
    denied.push("- Execute code snippets");
  }
  if (!permissions.fileAccess) {
    denied.push("- Read, write, or download files");
  }
  if (!permissions.browserAccess) {
    denied.push("- Automate or control the browser");
  }
  if (!permissions.skillAccess) {
    denied.push("- Create, edit, or use skills");
  }

  if (denied.length === 0) return null;

  return `# Restrictions\n\nYou are operating with limited permissions for this contact. You do NOT have permission to:\n${denied.join("\n")}\n\nIf the user asks you to do any of the above, politely decline and explain that you don't have permission for that action. Do not attempt workarounds.`;
}
