/**
 * Backup import — restores a .kaizen ZIP file into the database and filesystem.
 * Uses upsert strategy: existing records are updated, new ones created, nothing deleted.
 *
 * Handles ID conflicts for models with unique constraints (Tool.name, Extension.type,
 * etc.) by upserting on the business key and remapping IDs for relationship tables.
 */

import JSZip from "jszip";
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { setSecret, hasSecret } from "@/lib/vault/vault";
import { decryptForImport, type PortableVault } from "./vault-portable";
import type { BackupManifest } from "./export";

const WORKSPACE_DIR = path.join(process.cwd(), "workspace");
const WA_AUTH_DIR = path.join(process.cwd(), "data", "whatsapp-auth");
const WA_AUTH_PREFIX = "__wa_auth__";

export interface ImportResult {
  counts: Record<string, number>;
  warnings: string[];
}

export async function importBackup(
  buffer: Buffer,
  password: string,
): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(buffer);
  const warnings: string[] = [];

  // ── Validate manifest ──
  const manifestRaw = await zip.file("manifest.json")?.async("string");
  if (!manifestRaw) throw new Error("Invalid backup: missing manifest.json");

  const manifest: BackupManifest = JSON.parse(manifestRaw);
  if (manifest.app !== "kaizen") throw new Error("Invalid backup: not a Kaizen backup file");
  if (manifest.version > 2) throw new Error(`Unsupported backup version: ${manifest.version}. Please update Kaizen.`);

  // ── Parse data ──
  const dataRaw = await zip.file("data.json")?.async("string");
  if (!dataRaw) throw new Error("Invalid backup: missing data.json");
  const data = JSON.parse(dataRaw);

  // ── Decrypt vault ──
  const vaultRaw = await zip.file("vault.json")?.async("string");
  let secrets: Record<string, string> = {};
  if (vaultRaw) {
    const portableVault: PortableVault = JSON.parse(vaultRaw);
    secrets = decryptForImport(portableVault, password);
  }

  const counts: Record<string, number> = {};

  // ID remap tables for models with unique constraints beyond id
  const toolIdMap = new Map<string, string>();
  const extensionIdMap = new Map<string, string>();
  const mcpIdMap = new Map<string, string>();
  const vaultEntryIdMap = new Map<string, string>();

  // ── DB upserts in transaction ──
  await prisma.$transaction(async (tx) => {
    // 1. Agents
    if (data.agents?.length) {
      for (const agent of data.agents) {
        await tx.agentConfig.upsert({
          where: { id: agent.id },
          create: {
            id: agent.id,
            type: agent.type ?? "system",
            label: agent.label,
            model: agent.model,
            imageModel: agent.imageModel ?? null,
            fileModel: agent.fileModel ?? null,
            audioModel: agent.audioModel ?? null,
            videoModel: agent.videoModel ?? null,
            thinking: agent.thinking ?? false,
            timeout: agent.timeout ?? 120,
            enabled: agent.enabled ?? true,
            systemPrompt: agent.systemPrompt,
            customPrompt: agent.customPrompt ?? null,
            promptVersion: agent.promptVersion ?? 0,
          },
          update: {
            type: agent.type ?? "system",
            label: agent.label,
            model: agent.model,
            imageModel: agent.imageModel ?? null,
            fileModel: agent.fileModel ?? null,
            audioModel: agent.audioModel ?? null,
            videoModel: agent.videoModel ?? null,
            thinking: agent.thinking ?? false,
            timeout: agent.timeout ?? 120,
            enabled: agent.enabled ?? true,
            systemPrompt: agent.systemPrompt,
            customPrompt: agent.customPrompt ?? null,
            promptVersion: agent.promptVersion ?? 0,
          },
        });
      }
      counts.agents = data.agents.length;
    }

    // 2. Tools — upsert by `name` (unique), remap IDs
    if (data.tools?.length) {
      for (const tool of data.tools) {
        const result = await tx.tool.upsert({
          where: { name: tool.name },
          create: {
            id: tool.id,
            name: tool.name,
            description: tool.description,
            type: tool.type,
            config: tool.config ?? "{}",
            inputSchema: tool.inputSchema ?? "{}",
            outputSchema: tool.outputSchema ?? "{}",
            enabled: tool.enabled ?? true,
            memory: tool.memory ?? null,
            createdBy: tool.createdBy ?? "user",
          },
          update: {
            description: tool.description,
            type: tool.type,
            config: tool.config ?? "{}",
            inputSchema: tool.inputSchema ?? "{}",
            outputSchema: tool.outputSchema ?? "{}",
            enabled: tool.enabled ?? true,
            memory: tool.memory ?? null,
          },
        });
        if (result.id !== tool.id) {
          toolIdMap.set(tool.id, result.id);
        }
      }
      counts.tools = data.tools.length;
    }

    // 3. Souls
    if (data.souls?.length) {
      for (const soul of data.souls) {
        await tx.soul.upsert({
          where: { id: soul.id },
          create: {
            id: soul.id,
            name: soul.name,
            description: soul.description,
            traits: soul.traits,
            isActive: soul.isActive ?? false,
          },
          update: {
            name: soul.name,
            description: soul.description,
            traits: soul.traits,
            isActive: soul.isActive ?? false,
          },
        });
      }
      counts.souls = data.souls.length;
    }

    // 4. Extensions — upsert by `type` (unique), remap IDs, restore enabled
    if (data.extensions?.length) {
      for (const ext of data.extensions) {
        const result = await tx.extension.upsert({
          where: { type: ext.type },
          create: {
            id: ext.id,
            type: ext.type,
            name: ext.name,
            enabled: ext.enabled ?? false,
            config: ext.config ?? "{}",
            status: "disconnected",
          },
          update: {
            name: ext.name,
            enabled: ext.enabled ?? false,
            config: ext.config ?? "{}",
          },
        });
        if (result.id !== ext.id) {
          extensionIdMap.set(ext.id, result.id);
        }
      }
      counts.extensions = data.extensions.length;
    }

    // 5. Skills
    if (data.skills?.length) {
      for (const skill of data.skills) {
        await tx.skill.upsert({
          where: { id: skill.id },
          create: {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            instructions: skill.instructions,
            modelPref: skill.modelPref ?? null,
            enabled: skill.enabled ?? true,
            createdBy: skill.createdBy ?? "user",
          },
          update: {
            name: skill.name,
            description: skill.description,
            instructions: skill.instructions,
            modelPref: skill.modelPref ?? null,
            enabled: skill.enabled ?? true,
          },
        });
      }
      counts.skills = data.skills.length;
    }

    // 6. MCP Integrations — upsert by `provider` (unique), remap IDs, restore enabled
    if (data.mcpIntegrations?.length) {
      for (const mcp of data.mcpIntegrations) {
        const result = await tx.mcpIntegration.upsert({
          where: { provider: mcp.provider },
          create: {
            id: mcp.id,
            provider: mcp.provider,
            name: mcp.name,
            enabled: mcp.enabled ?? false,
            status: "disconnected",
            statusMsg: null,
            vaultKey: mcp.vaultKey,
            config: mcp.config ?? "{}",
          },
          update: {
            name: mcp.name,
            enabled: mcp.enabled ?? false,
            vaultKey: mcp.vaultKey,
            config: mcp.config ?? "{}",
          },
        });
        if (result.id !== mcp.id) {
          mcpIdMap.set(mcp.id, result.id);
        }
      }
      counts.mcpIntegrations = data.mcpIntegrations.length;
    }

    // 7. Vault entries — upsert by `vaultKey` (unique), remap IDs
    if (data.vaultEntries?.length) {
      for (const ve of data.vaultEntries) {
        const result = await tx.vaultEntry.upsert({
          where: { vaultKey: ve.vaultKey },
          create: {
            id: ve.id,
            vaultKey: ve.vaultKey,
            label: ve.label,
            description: ve.description ?? null,
            category: ve.category ?? "other",
            service: ve.service ?? null,
            fields: ve.fields ?? "{}",
          },
          update: {
            label: ve.label,
            description: ve.description ?? null,
            category: ve.category ?? "other",
            service: ve.service ?? null,
            fields: ve.fields ?? "{}",
          },
        });
        if (result.id !== ve.id) {
          vaultEntryIdMap.set(ve.id, result.id);
        }
      }
      counts.vaultEntries = data.vaultEntries.length;
    }

    // 8. Guardrails
    if (data.guardrails?.length) {
      for (const g of data.guardrails) {
        await tx.guardrail.upsert({
          where: { id: g.id },
          create: {
            id: g.id,
            skillId: g.skillId,
            rule: g.rule,
            type: g.type,
            editableBy: g.editableBy ?? "both",
          },
          update: {
            rule: g.rule,
            type: g.type,
            editableBy: g.editableBy ?? "both",
          },
        });
      }
      counts.guardrails = data.guardrails.length;
    }

    // 9. Skill attachments
    if (data.skillAttachments?.length) {
      for (const att of data.skillAttachments) {
        await tx.skillAttachment.upsert({
          where: { id: att.id },
          create: {
            id: att.id,
            skillId: att.skillId,
            filename: att.filename,
            diskPath: att.diskPath,
            mimeType: att.mimeType ?? "application/octet-stream",
            sizeBytes: att.sizeBytes ?? 0,
          },
          update: {
            filename: att.filename,
            diskPath: att.diskPath,
            mimeType: att.mimeType ?? "application/octet-stream",
            sizeBytes: att.sizeBytes ?? 0,
          },
        });
      }
      counts.skillAttachments = data.skillAttachments.length;
    }

    // 10. Channel contacts — remap extensionId
    if (data.channelContacts?.length) {
      for (const cc of data.channelContacts) {
        const mappedExtId = extensionIdMap.get(cc.extensionId) ?? cc.extensionId;
        await tx.channelContact.upsert({
          where: { extensionId_externalId: { extensionId: mappedExtId, externalId: cc.externalId } },
          create: {
            id: cc.id,
            extensionId: mappedExtId,
            externalId: cc.externalId,
            name: cc.name ?? "",
            enabled: cc.enabled ?? true,
            isSelf: cc.isSelf ?? false,
            soulId: cc.soulId ?? null,
            model: cc.model ?? null,
            customSoul: cc.customSoul ?? "",
            instructions: cc.instructions ?? "",
            responsePrefix: cc.responsePrefix ?? "",
            permissions: cc.permissions ?? "{}",
          },
          update: {
            name: cc.name ?? "",
            enabled: cc.enabled ?? true,
            isSelf: cc.isSelf ?? false,
            soulId: cc.soulId ?? null,
            model: cc.model ?? null,
            customSoul: cc.customSoul ?? "",
            instructions: cc.instructions ?? "",
            responsePrefix: cc.responsePrefix ?? "",
            permissions: cc.permissions ?? "{}",
          },
        });
      }
      counts.contacts = data.channelContacts.length;
    }

    // ── Conversation data (FK order: Chat → Objective → Run → Step/Artifact/Reflection → Message → ExtensionChat) ──

    // 11. Chats
    if (data.chats?.length) {
      for (const chat of data.chats) {
        await tx.chat.upsert({
          where: { id: chat.id },
          create: {
            id: chat.id,
            title: chat.title,
            hasUnread: chat.hasUnread ?? false,
            createdAt: new Date(chat.createdAt),
            updatedAt: new Date(chat.updatedAt),
          },
          update: {
            title: chat.title,
            hasUnread: chat.hasUnread ?? false,
          },
        });
      }
      counts.chats = data.chats.length;
    }

    // 12. Objectives (all — includes workflow-linked ones)
    if (data.objectives?.length) {
      for (const obj of data.objectives) {
        await tx.objective.upsert({
          where: { id: obj.id },
          create: {
            id: obj.id,
            title: obj.title,
            description: obj.description,
            status: obj.status ?? "active",
            phase: obj.phase ?? "triage",
            skillId: obj.skillId ?? null,
            config: obj.config ?? "{}",
          },
          update: {
            title: obj.title,
            description: obj.description,
            status: obj.status ?? "active",
            phase: obj.phase ?? "triage",
            skillId: obj.skillId ?? null,
            config: obj.config ?? "{}",
          },
        });
      }
      counts.objectives = data.objectives.length;
    }

    // 13. Runs
    if (data.runs?.length) {
      for (const run of data.runs) {
        await tx.run.upsert({
          where: { id: run.id },
          create: {
            id: run.id,
            objectiveId: run.objectiveId,
            sequence: run.sequence,
            status: run.status ?? "running",
            startedAt: new Date(run.startedAt),
            endedAt: run.endedAt ? new Date(run.endedAt) : null,
          },
          update: {
            status: run.status ?? "running",
            endedAt: run.endedAt ? new Date(run.endedAt) : null,
          },
        });
      }
      counts.runs = data.runs.length;
    }

    // 14. Steps — remap toolId
    if (data.steps?.length) {
      for (const step of data.steps) {
        const mappedToolId = step.toolId
          ? (toolIdMap.get(step.toolId) ?? step.toolId)
          : null;
        await tx.step.upsert({
          where: { id: step.id },
          create: {
            id: step.id,
            runId: step.runId,
            sequence: step.sequence,
            type: step.type,
            content: step.content,
            toolId: mappedToolId,
            createdAt: new Date(step.createdAt),
          },
          update: {
            type: step.type,
            content: step.content,
            toolId: mappedToolId,
          },
        });
      }
      counts.steps = data.steps.length;
    }

    // 15. Artifacts
    if (data.artifacts?.length) {
      for (const art of data.artifacts) {
        await tx.artifact.upsert({
          where: { id: art.id },
          create: {
            id: art.id,
            runId: art.runId,
            filename: art.filename,
            diskPath: art.diskPath,
            mimeType: art.mimeType ?? "application/octet-stream",
            sizeBytes: art.sizeBytes ?? 0,
            category: art.category ?? "file",
            summary: art.summary ?? null,
            intermediate: art.intermediate ?? false,
            metadata: art.metadata ?? "{}",
            createdAt: new Date(art.createdAt),
          },
          update: {
            filename: art.filename,
            diskPath: art.diskPath,
            mimeType: art.mimeType ?? "application/octet-stream",
            sizeBytes: art.sizeBytes ?? 0,
            category: art.category ?? "file",
            summary: art.summary ?? null,
            intermediate: art.intermediate ?? false,
            metadata: art.metadata ?? "{}",
          },
        });
      }
      counts.artifacts = data.artifacts.length;
    }

    // 16. Messages
    if (data.messages?.length) {
      for (const msg of data.messages) {
        await tx.message.upsert({
          where: { id: msg.id },
          create: {
            id: msg.id,
            chatId: msg.chatId,
            role: msg.role,
            content: msg.content,
            objectiveId: msg.objectiveId ?? null,
            runId: msg.runId ?? null,
            createdAt: new Date(msg.createdAt),
          },
          update: {
            role: msg.role,
            content: msg.content,
            objectiveId: msg.objectiveId ?? null,
            runId: msg.runId ?? null,
          },
        });
      }
      counts.messages = data.messages.length;
    }

    // 18. ExtensionChats — remap extensionId
    if (data.extensionChats?.length) {
      for (const ec of data.extensionChats) {
        const mappedExtId = extensionIdMap.get(ec.extensionId) ?? ec.extensionId;
        await tx.extensionChat.upsert({
          where: { chatId: ec.chatId },
          create: {
            id: ec.id,
            extensionId: mappedExtId,
            externalId: ec.externalId,
            chatId: ec.chatId,
            label: ec.label,
            createdAt: new Date(ec.createdAt),
          },
          update: {
            extensionId: mappedExtId,
            externalId: ec.externalId,
            label: ec.label,
          },
        });
      }
    }

    // 19. Schedules
    if (data.schedules?.length) {
      for (const sch of data.schedules) {
        await tx.schedule.upsert({
          where: { id: sch.id },
          create: {
            id: sch.id,
            name: sch.name,
            cron: sch.cron,
            enabled: sch.enabled ?? true,
            targetType: "skill",
            skillId: sch.skillId ?? null,
            destination: sch.destination ?? '{"type":"none"}',
            lastRunAt: sch.lastRunAt ? new Date(sch.lastRunAt) : null,
          },
          update: {
            name: sch.name,
            cron: sch.cron,
            enabled: sch.enabled ?? true,
            targetType: "skill",
            skillId: sch.skillId ?? null,
            destination: sch.destination ?? '{"type":"none"}',
          },
        });
      }
      counts.schedules = data.schedules.length;
    }

    // 20. M2M: SkillTool — remap toolId
    if (data.skillTools?.length) {
      for (const st of data.skillTools) {
        const mappedToolId = toolIdMap.get(st.toolId) ?? st.toolId;
        await tx.skillTool.upsert({
          where: { skillId_toolId: { skillId: st.skillId, toolId: mappedToolId } },
          create: { skillId: st.skillId, toolId: mappedToolId },
          update: {},
        });
      }
    }

    // 20b. M2M: SkillSubSkill
    if (data.skillSubSkills?.length) {
      for (const ss of data.skillSubSkills) {
        await tx.skillSubSkill.upsert({
          where: { parentSkillId_childSkillId: { parentSkillId: ss.parentSkillId, childSkillId: ss.childSkillId } },
          create: {
            parentSkillId: ss.parentSkillId,
            childSkillId: ss.childSkillId,
            position: ss.position ?? 0,
            role: ss.role ?? "",
          },
          update: {
            position: ss.position ?? 0,
            role: ss.role ?? "",
          },
        });
      }
    }

    // 21. M2M: SkillVaultEntry — remap vaultEntryId
    if (data.skillVaultEntries?.length) {
      for (const sv of data.skillVaultEntries) {
        const mappedVeId = vaultEntryIdMap.get(sv.vaultEntryId) ?? sv.vaultEntryId;
        await tx.skillVaultEntry.upsert({
          where: { skillId_vaultEntryId: { skillId: sv.skillId, vaultEntryId: mappedVeId } },
          create: { skillId: sv.skillId, vaultEntryId: mappedVeId },
          update: {},
        });
      }
    }

    // 22. M2M: SkillExtension — remap extensionId
    if (data.skillExtensions?.length) {
      for (const se of data.skillExtensions) {
        const mappedExtId = extensionIdMap.get(se.extensionId) ?? se.extensionId;
        await tx.skillExtension.upsert({
          where: { skillId_extensionId: { skillId: se.skillId, extensionId: mappedExtId } },
          create: { skillId: se.skillId, extensionId: mappedExtId },
          update: {},
        });
      }
    }

    // 23. Settings
    if (data.settings?.length) {
      for (const s of data.settings) {
        await tx.setting.upsert({
          where: { key: s.key },
          create: { key: s.key, value: s.value },
          update: { value: s.value },
        });
      }
      counts.settings = data.settings.length;
    }

    // 24. User memory
    if (data.userMemory?.content) {
      await tx.userMemory.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", content: data.userMemory.content },
        update: { content: data.userMemory.content },
      });
      counts.userMemory = 1;
    }
  });

  // ── Restore vault secrets (outside transaction — vault has its own mutex) ──
  let secretCount = 0;
  for (const [key, value] of Object.entries(secrets)) {
    if (key.startsWith(WA_AUTH_PREFIX)) continue; // Handled separately below
    await setSecret(key, value);
    secretCount++;
  }
  if (secretCount > 0) counts.vaultSecrets = secretCount;

  // ── Restore WhatsApp auth files (encrypted in vault secrets) ──
  const waAuthEntries = Object.entries(secrets).filter(([k]) => k.startsWith(WA_AUTH_PREFIX));
  if (waAuthEntries.length > 0) {
    await fs.mkdir(WA_AUTH_DIR, { recursive: true });
    for (const [key, base64Value] of waAuthEntries) {
      const filename = key.slice(WA_AUTH_PREFIX.length);
      const filePath = path.join(WA_AUTH_DIR, path.basename(filename));
      await fs.writeFile(filePath, Buffer.from(base64Value, "base64"));
    }
    counts.whatsappAuth = waAuthEntries.length;
  }

  // ── Update MCP integration statuses based on restored vault keys ──
  // API-key integrations (like Zapier) should show "connected" if their key exists
  const allMcpIntegrations = await prisma.mcpIntegration.findMany();
  for (const mcp of allMcpIntegrations) {
    const keyExists = await hasSecret(mcp.vaultKey);
    if (keyExists && mcp.status !== "connected") {
      await prisma.mcpIntegration.update({
        where: { id: mcp.id },
        data: { status: "connected" },
      });
    }
  }

  // ── Restore files ──
  const filesFolder = zip.folder("files");
  if (filesFolder) {
    const fileEntries: [string, JSZip.JSZipObject][] = [];
    filesFolder.forEach((relativePath, file) => {
      if (!file.dir) fileEntries.push([relativePath, file]);
    });

    for (const [relativePath, file] of fileEntries) {
      try {
        const destPath = path.join(WORKSPACE_DIR, relativePath);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        const content = await file.async("nodebuffer");
        await fs.writeFile(destPath, content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Failed to restore file ${relativePath}: ${msg}`);
      }
    }
    counts.files = fileEntries.length;
  }

  return { counts, warnings };
}
