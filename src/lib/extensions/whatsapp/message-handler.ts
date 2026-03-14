import type { BaileysEventMap } from "baileys";
import { prisma } from "@/lib/db/prisma";
import { createMessage } from "@/lib/chats/registry";
import { findOrCreateExtensionChat } from "@/lib/chats/registry";
import { executeRun, type AttachmentMeta } from "@/lib/agent/orchestrator";
import { registerRun, updateRunActivity, unregisterRun } from "@/lib/agent/active-runs";
import { createLog } from "@/lib/logs/logger";
import { parseWhatsAppConfig } from "./types";
import { forwardRunToWhatsApp } from "./media";
import { chatEvents } from "@/lib/events/chat-events";
import { findContact, findSelfContact, toRunContactProfile } from "@/lib/extensions/contacts";
import type { ContactProfile } from "@/lib/extensions/contacts";
import type { WhatsAppGateway } from "./gateway";
import { getUploadDir } from "@/lib/workspace";
import { promises as nodeFs } from "node:fs";
import nodePath from "node:path";
import crypto from "node:crypto";

type WAMessage = BaileysEventMap["messages.upsert"]["messages"][number];

// Track message IDs sent by the bot to avoid infinite self-chat loops
const sentMessageIds = new Set<string>();
const MAX_SENT_TRACKING = 500;

export function trackSentMessageId(id: string) {
  sentMessageIds.add(id);
  // Prevent unbounded growth
  if (sentMessageIds.size > MAX_SENT_TRACKING) {
    const first = sentMessageIds.values().next().value;
    if (first) sentMessageIds.delete(first);
  }
}

// ── Message batching ─────────────────────────────────────────
// When multiple messages arrive for the same chat in quick succession (e.g. 2 images),
// batch them into a single run instead of triggering separate runs per message.
const BATCH_WINDOW_MS = 1500;

interface PendingBatch {
  messages: WAMessage[];
  timer: ReturnType<typeof setTimeout>;
  extensionId: string;
  config: ReturnType<typeof parseWhatsAppConfig>;
  ownPhone: string | null;
  ownLid: string | null;
  gateway: WhatsAppGateway;
}

const pendingBatches = new Map<string, PendingBatch>();

/**
 * Handle incoming WhatsApp messages: filter, buffer by chat, run orchestrator, reply.
 */
export async function handleIncomingMessages(
  upsert: BaileysEventMap["messages.upsert"],
  gateway: WhatsAppGateway,
): Promise<void> {
  const ext = await prisma.extension.findUnique({ where: { type: "whatsapp" } });
  if (!ext || !ext.enabled) return;

  const config = parseWhatsAppConfig(ext.config);
  const ownPhone = config.phoneNumber ?? extractJidNumber(gateway.getUserJid());
  const ownLid = config.lid ?? extractJidNumber(gateway.getUserLid());

  for (const msg of upsert.messages) {
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid) continue;

    // Quick pre-filters before buffering (skip bot's own replies, non-content)
    if (msg.key.id && sentMessageIds.has(msg.key.id)) continue;
    const { text, mediaType } = extractMessageContent(msg);
    if (!text && !mediaType) continue;

    const existing = pendingBatches.get(remoteJid);
    if (existing) {
      // Add to existing batch and reset the timer
      existing.messages.push(msg);
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => flushBatch(remoteJid), BATCH_WINDOW_MS);
    } else {
      // Start a new batch
      const timer = setTimeout(() => flushBatch(remoteJid), BATCH_WINDOW_MS);
      pendingBatches.set(remoteJid, {
        messages: [msg],
        timer,
        extensionId: ext.id,
        config,
        ownPhone,
        ownLid,
        gateway,
      });
    }
  }
}

/** Flush a pending batch — process all buffered messages for a chat as one run. */
async function flushBatch(remoteJid: string): Promise<void> {
  const batch = pendingBatches.get(remoteJid);
  if (!batch) return;
  pendingBatches.delete(remoteJid);

  try {
    await processBatchedMessages(
      batch.messages, batch.extensionId, batch.config,
      batch.ownPhone, batch.ownLid, batch.gateway,
    );
  } catch (err) {
    createLog("error", "whatsapp", `Failed to process batch for ${remoteJid}: ${(err as Error).message}`).catch(() => {});
  }
}

/** Process a batch of messages from the same chat as a single run. */
async function processBatchedMessages(
  messages: WAMessage[],
  extensionId: string,
  config: ReturnType<typeof parseWhatsAppConfig>,
  ownPhone: string | null,
  ownLid: string | null,
  gateway: WhatsAppGateway,
): Promise<void> {
  // Use the first message to determine chat context (all share the same remoteJid)
  const firstMsg = messages[0];
  const remoteJid = firstMsg.key.remoteJid;
  if (!remoteJid) return;

  const isGroup = remoteJid.endsWith("@g.us");
  const senderJid = isGroup ? (firstMsg.key.participant ?? null) : remoteJid;
  if (!senderJid) return;

  const senderNum = extractJidNumber(senderJid);
  const isSelfChat = !isGroup && senderNum != null && (senderNum === ownPhone || senderNum === ownLid);

  // Resolve the actual phone number — LID JIDs need reverse lookup
  let senderPhone = senderNum;
  if (senderJid.endsWith("@lid") && senderNum) {
    const isSenderSelf = senderNum === ownPhone || senderNum === ownLid;
    if (!isSenderSelf) {
      senderPhone = await gateway.resolvePhoneForLid(senderNum) ?? senderNum;
    }
  }

  // ── Contact profile lookup ──────────────────────────────────
  let contactProfile: ContactProfile | null = null;
  if (isSelfChat) {
    contactProfile = await findSelfContact(extensionId);
  } else if (senderPhone) {
    contactProfile = await findContact(extensionId, senderPhone);
  }
  if (!contactProfile || !contactProfile.enabled) return;

  const rawPrefix = contactProfile.responsePrefix || "";
  const formattedPrefix = rawPrefix ? `[${rawPrefix}] ` : "";

  // Auto-detect and persist LID when we see a @lid self-chat message
  if (!config.lid && remoteJid.endsWith("@lid") && firstMsg.key.fromMe && senderNum) {
    config.lid = senderNum;
    prisma.extension.updateMany({
      where: { type: "whatsapp" },
      data: { config: JSON.stringify(config) },
    }).catch(() => {});
    return processBatchedMessages(messages, extensionId, config, ownPhone, senderNum, gateway);
  }

  // ── Process each message in the batch: filter, extract content, download media ──
  const textParts: string[] = [];
  const allAttachments: AttachmentMeta[] = [];
  const allMediaTypes: string[] = [];
  const reactKeys: WAMessage["key"][] = [];

  for (const msg of messages) {
    // Skip bot's own replies
    if (msg.key.fromMe && !isSelfChat) continue;

    const { text, mediaType, mimeType: mediaMimeType, filename: mediaFilename } = extractMessageContent(msg);
    if (!text && !mediaType) continue;

    // Skip our own prefixed replies
    if (formattedPrefix && text && text.startsWith(formattedPrefix)) continue;

    // Skip scheduled run trigger messages sent by the scheduler
    if (isSelfChat && text && text.startsWith("[Scheduled run]")) continue;

    if (text) textParts.push(text);
    if (mediaType) allMediaTypes.push(mediaType);
    reactKeys.push(msg.key);

    // Download media attachment if present
    if (mediaType) {
      try {
        const buffer = await gateway.downloadMedia(msg);
        if (buffer && buffer.length > 0) {
          const uploadId = crypto.randomUUID();
          const filename = mediaFilename || `media_${uploadId}${mimeExtension(mediaMimeType)}`;
          const uploadDir = await getUploadDir(uploadId);
          await nodeFs.writeFile(nodePath.join(uploadDir, filename), buffer);
          allAttachments.push({ uploadId, filename, mimeType: mediaMimeType || "application/octet-stream" });
        }
      } catch (err) {
        createLog("warn", "whatsapp", `Failed to download media: ${(err as Error).message}`, {
          messageId: msg.key?.id,
        }).catch(() => {});
      }
    }
  }

  // Nothing usable after filtering
  if (textParts.length === 0 && allAttachments.length === 0) return;

  const combinedText = textParts.join("\n\n");
  const displayText = combinedText || "";

  createLog("info", "whatsapp", `Incoming batch (${messages.length} msg) from ${senderJid}${isGroup ? ` in group ${remoteJid}` : ""}`, {
    textParts: textParts.length,
    attachments: allAttachments.length,
    preview: displayText.slice(0, 100),
  }).catch(() => {});

  // Find or create the mirrored Kaizen chat
  let label: string;
  if (isSelfChat) {
    label = `WhatsApp: ${contactProfile.name || "Self"}`;
  } else if (isGroup) {
    const groupName = await gateway.getGroupName(remoteJid);
    label = groupName ? `WhatsApp Group: ${groupName}` : `WhatsApp Group: ${extractJidNumber(remoteJid)}`;
  } else {
    label = `WhatsApp: ${contactProfile.name || firstMsg.pushName || `+${senderPhone}`}`;
  }
  const { chatId, isNew } = await findOrCreateExtensionChat(extensionId, remoteJid, label);
  if (isNew) chatEvents.emit({ type: "chat-created", chatId });

  // Build the objective description
  const attachmentHints = allAttachments.map((a) => `${a.filename} (${a.mimeType})`).join(", ");
  const objectiveDescription = combinedText
    ? (allAttachments.length > 0 ? `${combinedText}\n\n[Attached: ${attachmentHints}]` : combinedText)
    : (allAttachments.length > 0
        ? `The user sent ${allAttachments.length} ${allMediaTypes[0] || "media"} file(s) (${attachmentHints}). Respond naturally to the media as part of the conversation. If the file is not visible or you cannot process it, say so clearly — do NOT guess or make up content.`
        : displayText);

  // Build message content with embedded attachment refs
  let messageContent = displayText;
  if (allAttachments.length > 0) {
    const refs = allAttachments.map((a) =>
      a.mimeType.startsWith("image/")
        ? `![${a.filename}](/api/uploads/${a.uploadId}?filename=${encodeURIComponent(a.filename)})`
        : `[${a.filename}](/api/uploads/${a.uploadId}?filename=${encodeURIComponent(a.filename)})`
    );
    messageContent = [displayText, ...refs].filter(Boolean).join("\n\n");
  }

  // Save the user message
  const titleFallback = allMediaTypes.length > 0 ? `[${allMediaTypes.length} ${allMediaTypes[0]}(s)]` : "message";
  const objective = await prisma.objective.create({
    data: {
      title: (displayText || titleFallback).slice(0, 80),
      description: objectiveDescription,
      status: "active",
      phase: "triage",
    },
  });

  await createMessage({
    chatId,
    role: "user",
    content: messageContent,
    objectiveId: objective.id,
  });
  chatEvents.emit({ type: "chat-updated", chatId });

  // Acknowledge with eyes emoji on all messages in the batch
  for (const key of reactKeys) {
    await gateway.sendReaction(remoteJid, key, "\uD83D\uDC40").catch(() => {});
  }

  // Run orchestrator — single run for the entire batch
  let accumulated = "";
  let currentRunId: string | null = null;
  const runAbortController = new AbortController();
  const model = contactProfile.model ?? config.model ?? undefined;

  await executeRun(
    {
      objectiveId: objective.id,
      chatId,
      model,
      signal: runAbortController.signal,
      contactProfile: toRunContactProfile(contactProfile),
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
    },
    {
      onRunCreated: async (runId) => {
        currentRunId = runId;
        registerRun(runId, runAbortController, chatId);
        chatEvents.emit({ type: "run-started", chatId, runId });
        await createMessage({
          chatId,
          role: "assistant",
          content: "",
          objectiveId: objective.id,
          runId,
        }).catch(() => {});
      },
      onStep: (step) => {
        const labelMap: Record<string, string> = {
          routing: "Thinking", search: "Searching", reasoning: "Thinking",
          developer_enhancement: "Coding",
          pipeline_execution: "Testing", review: "Reviewing",
          pipeline_summary: "Finishing",
        };
        const label = labelMap[(step as { type: string }).type];
        if (label && currentRunId) {
          updateRunActivity(currentRunId, label);
          chatEvents.emit({ type: "run-activity", chatId, label });
        }
        chatEvents.emit({ type: "run-step", chatId, step });
      },
      onDelta: (text) => {
        accumulated += text;
        chatEvents.emit({ type: "run-delta", chatId, text });
      },
      onComplete: async (runId) => {
        unregisterRun(runId);

        const reply = accumulated.trim();
        if (!reply) return;

        await forwardRunToWhatsApp(remoteJid, reply, runId, rawPrefix);

        const lastMsg = await prisma.message.findFirst({
          where: { chatId, role: "assistant", objectiveId: objective.id },
          orderBy: { createdAt: "desc" },
        });
        if (lastMsg) {
          await prisma.message.update({
            where: { id: lastMsg.id },
            data: { content: reply },
          });
        }

        await prisma.chat.update({
          where: { id: chatId },
          data: { hasUnread: true },
        }).catch(() => {});

        chatEvents.emit({ type: "run-complete", chatId, runId });
        chatEvents.emit({ type: "chat-unread", chatId });

        createLog("info", "whatsapp", `Reply sent to ${remoteJid}`, {
          length: reply.length,
        }).catch(() => {});
      },
      onError: async (error) => {
        if (currentRunId) unregisterRun(currentRunId);

        const errorMsg = `${formattedPrefix}Sorry, I encountered an error processing your message.`;
        await gateway.sendMessage(remoteJid, errorMsg).catch(() => {});

        // Persist the error message in the Kaizen chat so it's visible in the UI
        const errorContent = `Sorry, I encountered an error processing your message.`;
        const lastMsg = await prisma.message.findFirst({
          where: { chatId, role: "assistant", objectiveId: objective.id },
          orderBy: { createdAt: "desc" },
        });
        if (lastMsg) {
          await prisma.message.update({
            where: { id: lastMsg.id },
            data: { content: errorContent },
          }).catch(() => {});
        }

        chatEvents.emit({ type: "run-error", chatId, error: String(error) });

        createLog("error", "whatsapp", `Run failed for ${remoteJid}: ${error}`).catch(() => {});
      },
    },
  );
}

/** Extract text + media info from a WAMessage. */
function extractMessageContent(msg: WAMessage): {
  text: string | null;
  mediaType: string | null;
  mimeType: string | null;
  filename: string | null;
} {
  const m = msg.message;
  if (!m) return { text: null, mediaType: null, mimeType: null, filename: null };

  // Direct text conversation (no media)
  if (m.conversation) return { text: m.conversation, mediaType: null, mimeType: null, filename: null };
  if (m.extendedTextMessage?.text) return { text: m.extendedTextMessage.text, mediaType: null, mimeType: null, filename: null };

  // Image
  if (m.imageMessage) {
    return {
      text: m.imageMessage.caption || null,
      mediaType: "image",
      mimeType: m.imageMessage.mimetype || "image/jpeg",
      filename: null,
    };
  }

  // Video
  if (m.videoMessage) {
    return {
      text: m.videoMessage.caption || null,
      mediaType: "video",
      mimeType: m.videoMessage.mimetype || "video/mp4",
      filename: null,
    };
  }

  // Document
  if (m.documentMessage) {
    return {
      text: m.documentMessage.caption || null,
      mediaType: "document",
      mimeType: m.documentMessage.mimetype || "application/octet-stream",
      filename: m.documentMessage.fileName || null,
    };
  }

  // Audio
  if (m.audioMessage) {
    return {
      text: null,
      mediaType: "audio",
      mimeType: m.audioMessage.mimetype || "audio/ogg",
      filename: null,
    };
  }

  // Sticker
  if (m.stickerMessage) {
    return {
      text: null,
      mediaType: "sticker",
      mimeType: m.stickerMessage.mimetype || "image/webp",
      filename: null,
    };
  }

  return { text: null, mediaType: null, mimeType: null, filename: null };
}

/** Map MIME type to file extension. */
function mimeExtension(mime: string | null): string {
  if (!mime) return "";
  // Strip parameters (e.g. "audio/ogg; codecs=opus" → "audio/ogg")
  const base = mime.split(";")[0].trim();
  const map: Record<string, string> = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
    "video/mp4": ".mp4", "audio/ogg": ".ogg", "audio/mpeg": ".mp3", "audio/mp4": ".m4a",
    "application/pdf": ".pdf",
  };
  return map[base] || "";
}

/** Extract the bare numeric ID from a JID (strips @domain and :device suffix). */
function extractJidNumber(jid: string | null): string | null {
  if (!jid) return null;
  return jid.split("@")[0].split(":")[0] || null;
}

// Re-export the gateway type so it can be imported cleanly
export type { WhatsAppGateway } from "./gateway";
