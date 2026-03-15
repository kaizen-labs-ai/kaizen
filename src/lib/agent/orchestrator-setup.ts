/**
 * Orchestrator setup: chat history loading, image enrichment, and attachment handling.
 * Extracted from orchestrator.ts to keep the main run coordinator focused on dispatch logic.
 */

import { prisma } from "@/lib/db/prisma";
import {
  type ChatMessage,
  type ContentPart,
  textPart,
  imagePart,
  videoPart,
  inputAudioPart,
  filePart,
} from "@/lib/openrouter/client";
import { createLog } from "@/lib/logs/logger";
import { toAbsolutePath, toRelativePath, getRunArtifactsDir } from "@/lib/workspace";
import { promises as nodeFs } from "node:fs";
import nodePath from "node:path";
import type { AttachmentMeta } from "./orchestrator";

// ── Types ──────────────────────────────────────────────────────

export interface ChatSetupResult {
  chatHistory: ChatMessage[];
  uploadParts: ContentPart[];
  /** Build user content with optional upload parts injected */
  buildUserContent: (text: string) => string | ContentPart[];
}

// Regex for detecting image artifact references in chat messages
const ARTIFACT_IMG_RE = /!\[([^\]]*)\]\(\/api\/artifacts\/([a-z0-9]+)\/download[^)]*\)/g;

// ── Chat History Loading ───────────────────────────────────────

/**
 * Load chat history from the database, enrich assistant messages with image
 * vision content, and process uploaded file attachments into ContentParts.
 */
export async function loadChatAndAttachments(
  chatId: string | undefined,
  isFollowUp: boolean,
  runId: string,
  attachments: AttachmentMeta[] | undefined,
): Promise<ChatSetupResult> {
  // ── LOAD CHAT HISTORY ──
  const chatHistory: ChatMessage[] = [];
  if (chatId) {
    const priorMessages = await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: "asc" },
    });

    const nonEmptyMessages = priorMessages.filter((m) => m.content.trim() !== "");

    if (isFollowUp) {
      for (const m of nonEmptyMessages) {
        chatHistory.push({
          role: m.role as "user" | "assistant",
          content: m.content,
        });
      }
    } else {
      // Exclude the current user message (last user msg) — it's passed
      // separately as the objective description to avoid duplication.
      let lastUserIdx = -1;
      for (let i = nonEmptyMessages.length - 1; i >= 0; i--) {
        if (nonEmptyMessages[i].role === "user") {
          lastUserIdx = i;
          break;
        }
      }

      for (let msgIdx = 0; msgIdx < nonEmptyMessages.length; msgIdx++) {
        if (msgIdx === lastUserIdx) continue;
        chatHistory.push({
          role: nonEmptyMessages[msgIdx].role as "user" | "assistant",
          content: nonEmptyMessages[msgIdx].content,
        });
      }
    }
  }

  // ── ENRICH CHAT HISTORY WITH IMAGE VISION ──
  for (let i = 0; i < chatHistory.length; i++) {
    const msg = chatHistory[i];
    if (msg.role !== "assistant" || typeof msg.content !== "string") continue;
    const matches = [...msg.content.matchAll(ARTIFACT_IMG_RE)];
    if (matches.length === 0) continue;

    const parts: ContentPart[] = [];
    parts.push(textPart(msg.content));

    const imageResults = await Promise.all(
      matches.map(async (match) => {
        const artifactId = match[2];
        try {
          const artifact = await prisma.artifact.findUnique({
            where: { id: artifactId },
            select: { diskPath: true, mimeType: true },
          });
          if (artifact?.diskPath && artifact.mimeType?.startsWith("image/")) {
            const absPath = toAbsolutePath(artifact.diskPath);
            const buffer = await nodeFs.readFile(absPath);
            return imagePart(buffer.toString("base64"), artifact.mimeType, "low");
          }
        } catch { /* skip unreadable images */ }
        return null;
      })
    );
    for (const img of imageResults) {
      if (img) parts.push(img);
    }

    if (parts.length > 1) {
      chatHistory[i] = { ...msg, content: parts };
    }
  }

  // ── LOAD UPLOADED ATTACHMENTS ──
  const uploadParts: ContentPart[] = [];
  const uploadPathHints: string[] = [];
  const UPLOADS_BASE = nodePath.join(process.cwd(), "workspace", "uploads");

  if (attachments?.length) {
    const runArtifactsDir = await getRunArtifactsDir(runId);

    for (const att of attachments) {
      try {
        const srcPath = nodePath.join(UPLOADS_BASE, att.uploadId, att.filename);
        const buffer = await nodeFs.readFile(srcPath);

        // Copy to run artifacts dir and create Artifact record
        const destPath = nodePath.join(runArtifactsDir, att.filename);
        await nodeFs.copyFile(srcPath, destPath);
        await prisma.artifact.create({
          data: {
            runId,
            filename: att.filename,
            diskPath: toRelativePath(destPath),
            mimeType: att.mimeType,
            sizeBytes: buffer.length,
            category: "upload",
            summary: "User-uploaded file",
          },
        });

        // Track path so the executor can reference it (e.g. for skill attachmentPaths)
        uploadPathHints.push(`- ${att.filename} (${att.mimeType}): ${toRelativePath(destPath)}`);

        // Build the content part for the LLM
        const base64 = buffer.toString("base64");
        if (att.mimeType.startsWith("image/")) {
          uploadParts.push(imagePart(base64, att.mimeType, "high"));
        } else if (att.mimeType.startsWith("video/")) {
          uploadParts.push(videoPart(base64, att.mimeType, att.filename));
        } else if (att.mimeType.startsWith("audio/")) {
          const audioFormat = att.mimeType.split("/")[1]?.split(";")[0] || "ogg";
          uploadParts.push(inputAudioPart(base64, audioFormat));
        } else if (att.mimeType === "application/pdf") {
          uploadParts.push(filePart(base64, att.mimeType, att.filename));
        } else {
          const text = buffer.toString("utf-8");
          uploadParts.push(textPart(`### File: ${att.filename}\n\n\`\`\`\n${text}\n\`\`\``));
        }
      } catch (err) {
        createLog("warn", "coordinator", `Failed to load attachment ${att.filename}: ${err}`, {}, runId).catch(() => {});
      }
    }
  }

  function buildUserContent(text: string): string | ContentPart[] {
    const enrichedText = uploadPathHints.length > 0
      ? `${text}\n\n[Uploaded files — use these paths for attachmentPaths if creating/editing a skill]\n${uploadPathHints.join("\n")}`
      : text;
    if (uploadParts.length === 0) return enrichedText;
    return [textPart(enrichedText), ...uploadParts];
  }

  return { chatHistory, uploadParts, buildUserContent };
}

// ── Recent tool usage summary ─────────────────────────────────

/**
 * Build a short summary of plugins/tools used in recent runs of the same chat.
 * Injected as system context so the executor knows which plugin to work with
 * even when chat history compaction loses that detail.
 */
export async function buildRecentToolUsage(chatId: string | undefined, currentRunId: string): Promise<string | null> {
  if (!chatId) return null;

  // Find recent runs in this chat (excluding the current one)
  const recentRuns = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT r.id
    FROM "Run" r
    JOIN "Objective" o ON r."objectiveId" = o.id
    JOIN "Message" m ON m."objectiveId" = o.id
    WHERE m."chatId" = ${chatId}
      AND r.id != ${currentRunId}
    ORDER BY r."startedAt" DESC
    LIMIT 3
  `;

  if (recentRuns.length === 0) return null;

  const runIds = recentRuns.map((r) => r.id);

  // Get tool_call steps for these runs — focus on plugin/skill usage
  const steps = await prisma.step.findMany({
    where: {
      runId: { in: runIds },
      type: "tool_call",
    },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  });

  // Extract unique plugin/skill tool names used
  const pluginTools = new Set<string>();
  const otherTools = new Set<string>();
  for (const step of steps) {
    try {
      const data = JSON.parse(step.content);
      const name = data.name as string;
      if (!name) continue;
      // Skip admin/infrastructure tools
      if (["advance-phase", "brave-search", "brave-image-search",
           "brave-instant", "brave-news-search", "brave-video-search",
           "web-fetch", "chrome-snapshot", "chrome-click", "chrome-fill",
           "chrome-navigate", "chrome-evaluate", "chrome-wait",
           "chrome-new-tab", "chrome-select-tab", "chrome-list-tabs",
           "context7-resolve", "context7-docs", "run-snippet",
           "download-image", "save-result", "file-write", "file-read",
      ].includes(name)) continue;

      if (["create-plugin", "edit-plugin", "create-skill", "edit-skill"].includes(name)) {
        // Extract the target plugin/skill name from arguments
        const args = data.arguments;
        if (args?.name) pluginTools.add(`${name} → ${args.name}`);
        else otherTools.add(name);
      } else {
        // This could be a plugin being executed (e.g., "portfolio-v2-rae-cv")
        pluginTools.add(name);
      }
    } catch { /* skip malformed steps */ }
  }

  if (pluginTools.size === 0 && otherTools.size === 0) return null;

  const lines: string[] = ["## Recent Tool Usage (prior runs in this conversation)"];
  if (pluginTools.size > 0) {
    lines.push("Plugins/skills used recently:");
    for (const t of pluginTools) lines.push(`- ${t}`);
  }
  if (otherTools.size > 0) {
    for (const t of otherTools) lines.push(`- ${t}`);
  }
  lines.push("When modifying or re-running plugins, use the MOST RECENTLY used one unless the user specifies otherwise.");

  return lines.join("\n");
}

// ── Prior artifact URL dedup ──────────────────────────────────

/**
 * Load source URLs of previously-downloaded images in a chat.
 * Returns the URLs or null if none found. Used to prevent the executor
 * from re-downloading the same images across runs.
 */
export async function loadPriorArtifactUrls(chatId: string): Promise<string[] | null> {
  const chatMessages = await prisma.message.findMany({
    where: { chatId, runId: { not: null } },
    select: { runId: true },
    distinct: ["runId"],
  });
  const runIds = chatMessages.map((m) => m.runId).filter((id): id is string => id !== null);
  if (runIds.length === 0) return null;

  const priorArtifacts = await prisma.artifact.findMany({
    where: { runId: { in: runIds }, mimeType: { startsWith: "image/" }, NOT: { metadata: "{}" } },
    select: { metadata: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const usedUrls: string[] = [];
  for (const art of priorArtifacts) {
    try {
      const meta = JSON.parse(art.metadata);
      if (meta.sourceUrl) usedUrls.push(meta.sourceUrl);
    } catch { /* skip */ }
  }
  return usedUrls.length > 0 ? usedUrls : null;
}
