/**
 * Backup export — collects all user data into a .kaizen ZIP file.
 * Includes: configuration, conversations, outputs, vault secrets, and auth files.
 */

import JSZip from "jszip";
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { getAllSecrets } from "@/lib/vault/vault";
import { encryptForExport } from "./vault-portable";
import { toAbsolutePath } from "@/lib/workspace";

const MANIFEST_VERSION = 2;
const SCHEMA_VERSION = "2025-03-04";
const WA_AUTH_DIR = path.join(process.cwd(), "data", "whatsapp-auth");
const WA_AUTH_PREFIX = "__wa_auth__";

export interface BackupManifest {
  version: number;
  schemaVersion: string;
  createdAt: string;
  app: "kaizen";
  counts: Record<string, number>;
}

export async function exportBackup(password: string): Promise<Buffer> {
  const zip = new JSZip();

  // ── Query all models ──
  const [
    agents,
    tools,
    skills,
    skillTools,
    guardrails,
    skillAttachments,
    skillExtensions,
    skillVaultEntries,
    skillSubSkills,
    schedules,
    souls,
    extensions,
    channelContacts,
    mcpIntegrations,
    vaultEntries,
    settings,
    userMemory,
    // Conversation data
    chats,
    messages,
    objectives,
    runs,
    steps,
    artifacts,
    extensionChats,
  ] = await Promise.all([
    prisma.agentConfig.findMany(),
    prisma.tool.findMany(),
    prisma.skill.findMany(),
    prisma.skillTool.findMany(),
    prisma.guardrail.findMany(),
    prisma.skillAttachment.findMany(),
    prisma.skillExtension.findMany(),
    prisma.skillVaultEntry.findMany(),
    prisma.skillSubSkill.findMany(),
    prisma.schedule.findMany(),
    prisma.soul.findMany(),
    prisma.extension.findMany(),
    prisma.channelContact.findMany(),
    prisma.mcpIntegration.findMany(),
    prisma.vaultEntry.findMany(),
    prisma.setting.findMany(),
    prisma.userMemory.findFirst(),
    // Conversation data
    prisma.chat.findMany(),
    prisma.message.findMany(),
    prisma.objective.findMany(),
    prisma.run.findMany(),
    prisma.step.findMany(),
    prisma.artifact.findMany(),
    prisma.extensionChat.findMany(),
  ]);

  // ── Build data.json ──
  const data = {
    agents,
    tools,
    skills,
    skillTools,
    guardrails,
    skillAttachments,
    skillExtensions,
    skillVaultEntries,
    skillSubSkills,
    schedules,
    souls,
    extensions,
    channelContacts,
    mcpIntegrations,
    vaultEntries,
    settings,
    userMemory: userMemory ? { content: userMemory.content } : null,
    // Conversation data
    chats,
    messages,
    objectives,
    runs,
    steps,
    artifacts,
    extensionChats,
  };

  zip.file("data.json", JSON.stringify(data, null, 2));

  // ── Encrypt vault secrets + WhatsApp auth ──
  const secrets = await getAllSecrets();

  // Include WhatsApp auth files (encrypted alongside vault secrets)
  try {
    const authFiles = await fs.readdir(WA_AUTH_DIR);
    for (const filename of authFiles) {
      const filePath = path.join(WA_AUTH_DIR, filename);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      const content = await fs.readFile(filePath);
      secrets[`${WA_AUTH_PREFIX}${filename}`] = content.toString("base64");
    }
  } catch {
    // No WhatsApp auth directory — skip
  }

  const portableVault = encryptForExport(secrets, password);
  zip.file("vault.json", JSON.stringify(portableVault, null, 2));

  // ── Collect files ──
  // Plugin scripts
  for (const tool of tools) {
    if (tool.type !== "plugin") continue;
    try {
      const config = JSON.parse(tool.config);
      if (!config.scriptPath) continue;
      const absPath = toAbsolutePath(config.scriptPath);
      const content = await fs.readFile(absPath);
      const relPath = config.scriptPath.replace(/^workspace[\\/]/, "");
      zip.file(`files/${relPath}`, content);
    } catch {
      // Skip missing files
    }
  }

  // Skill attachments
  for (const att of skillAttachments) {
    try {
      const absPath = toAbsolutePath(att.diskPath);
      const content = await fs.readFile(absPath);
      const relPath = att.diskPath.replace(/^workspace[\\/]/, "");
      zip.file(`files/${relPath}`, content);
    } catch {
      // Skip missing files
    }
  }

  // Artifact files
  for (const art of artifacts) {
    try {
      const absPath = toAbsolutePath(art.diskPath);
      const content = await fs.readFile(absPath);
      const relPath = art.diskPath.replace(/^workspace[\\/]/, "");
      zip.file(`files/${relPath}`, content);
    } catch {
      // Skip missing files
    }
  }

  // Skill databases (per-skill SQLite files)
  for (const skill of skills) {
    try {
      const dbPath = path.join(process.cwd(), "workspace", "skills", skill.id, "skill.db");
      const content = await fs.readFile(dbPath);
      zip.file(`files/skills/${skill.id}/skill.db`, content);
    } catch {
      // No database for this skill — skip
    }
  }

  // ── Build manifest ──
  const manifest: BackupManifest = {
    version: MANIFEST_VERSION,
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    app: "kaizen",
    counts: {
      agents: agents.length,
      tools: tools.length,
      skills: skills.length,
      souls: souls.length,
      extensions: extensions.length,
      contacts: channelContacts.length,
      mcpIntegrations: mcpIntegrations.length,
      vaultEntries: vaultEntries.length,
      settings: settings.length,
      chats: chats.length,
      messages: messages.length,
      artifacts: artifacts.length,
    },
  };

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  // ── Generate ZIP ──
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return buffer;
}
