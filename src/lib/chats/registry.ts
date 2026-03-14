import { prisma } from "@/lib/db/prisma";
import { callOpenRouter } from "@/lib/openrouter/client";
import { ensureAgentConfigs, TITLER_DEFAULT_PROMPT } from "@/lib/agents/defaults";
import { createLog } from "@/lib/logs/logger";
import { toAbsolutePath } from "@/lib/workspace";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function createChat(title?: string) {
  return prisma.chat.create({
    data: { title: title || "New Chat" },
  });
}

export async function getAllChats() {
  return prisma.chat.findMany({
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 3,
      },
      extensionChat: {
        select: { extension: { select: { type: true } } },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

const chatInclude = {
  messages: {
    orderBy: { createdAt: "asc" as const },
    include: {
      objective: {
        select: { id: true, phase: true },
      },
      run: {
        include: {
          steps: { orderBy: { sequence: "asc" as const } },
          artifacts: {
            where: { intermediate: false, category: { in: ["file", "data"] } },
            select: { id: true, filename: true, mimeType: true, sizeBytes: true, summary: true },
            orderBy: { createdAt: "asc" as const },
          },
        },
      },
    },
  },
};

export async function getChatWithMessages(id: string) {
  const chat = await prisma.chat.findUnique({
    where: { id },
    include: chatInclude,
  });
  if (!chat) return null;

  // ── Orphaned run recovery ──
  // Find runs that have steps but no linked assistant message. This happens when
  // the process crashes or times out before onComplete/onError can save a message.
  const objectiveIds = [...new Set(
    chat.messages.filter(m => m.objectiveId).map(m => m.objectiveId!)
  )];
  const linkedRunIds = new Set(
    chat.messages.filter(m => m.runId).map(m => m.runId!)
  );

  if (objectiveIds.length > 0) {
    const orphanedRuns = await prisma.run.findMany({
      where: {
        objectiveId: { in: objectiveIds },
        id: { notIn: [...linkedRunIds] },
        steps: { some: {} }, // Only runs that actually have steps
      },
      select: { id: true, objectiveId: true, status: true },
    });

    if (orphanedRuns.length > 0) {
      for (const run of orphanedRuns) {
        // Mark stale "running" runs as failed
        if (run.status === "running") {
          await prisma.run.update({
            where: { id: run.id },
            data: { status: "failed", endedAt: new Date() },
          });
        }

        // Create the missing assistant message so steps become visible
        await prisma.message.create({
          data: {
            chatId: id,
            role: "assistant",
            content: run.status === "running" || run.status === "failed"
              ? "This run encountered an error."
              : "",
            objectiveId: run.objectiveId,
            runId: run.id,
          },
        });
      }

      // Re-query to include the newly created messages
      return prisma.chat.findUnique({
        where: { id },
        include: chatInclude,
      });
    }
  }

  return chat;
}

export async function updateChatTitle(id: string, title: string) {
  return prisma.chat.update({
    where: { id },
    data: { title },
  });
}

export async function deleteChat(id: string) {
  return deleteManyChats([id]);
}

export async function deleteManyChats(ids: string[]) {
  // ── Collect disk paths BEFORE deleting DB records ──
  const messages = await prisma.message.findMany({
    where: { chatId: { in: ids } },
    select: { objectiveId: true, content: true },
  });
  const objectiveIds = [...new Set(messages.map(m => m.objectiveId).filter(Boolean))] as string[];

  // Extract upload IDs referenced in message content (markdown links to /api/uploads/{uuid})
  const uploadIds = new Set<string>();
  const uploadPattern = /\/api\/uploads\/([0-9a-f-]{36})/g;
  for (const msg of messages) {
    let match;
    while ((match = uploadPattern.exec(msg.content)) !== null) {
      uploadIds.add(match[1]);
    }
  }

  let runsWithArtifacts: { id: string; artifacts: { diskPath: string }[] }[] = [];
  if (objectiveIds.length > 0) {
    runsWithArtifacts = await prisma.run.findMany({
      where: { objectiveId: { in: objectiveIds } },
      select: { id: true, artifacts: { select: { diskPath: true } } },
    });
  }
  const runIds = runsWithArtifacts.map(r => r.id);

  // ── Delete DB records in transaction ──
  await prisma.$transaction(async (tx) => {
    if (runIds.length > 0) {
      await tx.step.deleteMany({ where: { runId: { in: runIds } } });
      await tx.artifact.deleteMany({ where: { runId: { in: runIds } } });
      await tx.run.deleteMany({ where: { id: { in: runIds } } });
    }
    if (objectiveIds.length > 0) {
      await tx.objective.deleteMany({ where: { id: { in: objectiveIds } } });
    }
    await tx.message.deleteMany({ where: { chatId: { in: ids } } });
    await tx.extensionChat.deleteMany({ where: { chatId: { in: ids } } });
    await tx.chat.deleteMany({ where: { id: { in: ids } } });
  });

  // ── Clean up artifact files and run directories from disk (best-effort) ──
  const artifactsBase = toAbsolutePath("workspace/artifacts");
  for (const run of runsWithArtifacts) {
    for (const artifact of run.artifacts) {
      try { await fs.unlink(toAbsolutePath(artifact.diskPath)); } catch {}
    }
    try { await fs.rm(path.join(artifactsBase, run.id), { recursive: true, force: true }); } catch {}
  }

  // ── Clean up upload folders from disk (best-effort) ──
  const uploadsBase = toAbsolutePath("workspace/uploads");
  for (const uploadId of uploadIds) {
    try { await fs.rm(path.join(uploadsBase, uploadId), { recursive: true, force: true }); } catch {}
  }

  // ── Clean up snippet folders from disk (best-effort) ──
  const snippetsBase = toAbsolutePath("workspace/_snippets");
  for (const run of runsWithArtifacts) {
    try { await fs.rm(path.join(snippetsBase, run.id), { recursive: true, force: true }); } catch {}
  }
}

export async function createMessage(data: {
  chatId: string;
  role: string;
  content: string;
  objectiveId?: string;
  runId?: string;
}) {
  await prisma.chat.update({
    where: { id: data.chatId },
    data: { updatedAt: new Date() },
  });

  return prisma.message.create({
    data: {
      chatId: data.chatId,
      role: data.role,
      content: data.content,
      objectiveId: data.objectiveId,
      runId: data.runId,
    },
  });
}

export async function updateMessage(id: string, content: string) {
  return prisma.message.update({
    where: { id },
    data: { content },
  });
}

/**
 * Generate a chat title from the user's first message using the titler agent.
 * Updates the chat title in the DB and returns it.
 */
/**
 * Find or create a Kaizen chat linked to an external extension conversation.
 * Used by WhatsApp (and future extensions) to mirror external chats.
 */
export async function findOrCreateExtensionChat(
  extensionId: string,
  externalId: string,
  label: string,
): Promise<{ chatId: string; isNew: boolean }> {
  const existing = await prisma.extensionChat.findUnique({
    where: { extensionId_externalId: { extensionId, externalId } },
  });
  if (existing) return { chatId: existing.chatId, isNew: false };

  const chat = await prisma.chat.create({
    data: { title: label },
  });
  await prisma.extensionChat.create({
    data: { extensionId, externalId, chatId: chat.id, label },
  });
  return { chatId: chat.id, isNew: true };
}

/**
 * Generate a chat title from the user's first message using the titler agent.
 * Updates the chat title in the DB and returns it.
 */
export async function generateChatTitle(
  chatId: string,
  userMessage: string
): Promise<string> {
  await ensureAgentConfigs();
  const agentConfig = await prisma.agentConfig.findUnique({
    where: { id: "titler" },
  });

  const model = agentConfig?.model ?? "openai/gpt-4o-mini";
  const systemPrompt = agentConfig?.systemPrompt ?? TITLER_DEFAULT_PROMPT;

  const response = await callOpenRouter({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    stream: false,
    thinking: false,
    timeout: (agentConfig?.timeout ?? 30) * 1000,
    meta: { agentId: "titler" },
  });

  // Clean up: remove quotes, trim, limit length
  const title = response.content
    .replace(/^["']|["']$/g, "")
    .trim()
    .slice(0, 80) || userMessage.slice(0, 50);

  await prisma.chat.update({
    where: { id: chatId },
    data: { title },
  });

  createLog("info", "titler", `Generated title: "${title}"`, {
    chatId,
  }).catch(() => {});

  return title;
}
