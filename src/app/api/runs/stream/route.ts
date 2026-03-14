import { executeRun } from "@/lib/agent/orchestrator";
import { createMessage, updateMessage } from "@/lib/chats/registry";
import { prisma } from "@/lib/db/prisma";
import { registerRun, unregisterRun, updateRunActivity } from "@/lib/agent/active-runs";
import { chatEvents } from "@/lib/events/chat-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Step type → human-readable activity label (used for run status updates). */
const STEP_LABEL_MAP: Record<string, string> = {
  routing: "Thinking",
  search: "Searching",
  reasoning: "Thinking",
  developer_enhancement: "Coding",
  pipeline_execution: "Testing",
  review: "Reviewing",
  pipeline_summary: "Finishing",
};

export async function POST(req: Request) {
  const body = await req.json();
  const { objectiveId, chatId, model, attachments, skillId, pluginId } = body;

  if (!objectiveId) {
    return new Response("objectiveId is required", { status: 400 });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Run-owned abort controller — NOT tied to client connection.
  // Only triggered by explicit POST /api/runs/{id}/stop.
  const runAbortController = new AbortController();

  // Track whether the SSE client is still connected
  let clientGone = false;

  // When client disconnects: stop writing SSE, but DON'T abort the run
  req.signal.addEventListener("abort", () => {
    clientGone = true;
    writer.close().catch(() => {});
  });

  // Accumulate reasoning text server-side so we can persist the assistant
  // message even if the client disconnects during streaming.
  let accumulatedContent = "";

  // ID of the assistant message created early (on run creation).
  // Used by onComplete/onError to UPDATE instead of creating a new message.
  let savedMessageId: string | null = null;
  let currentRunId: string | null = null;

  function sendSSE(event: string, data: unknown) {
    if (clientGone) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    writer.write(encoder.encode(payload)).catch(() => {
      clientGone = true;
    });
  }

  async function markChatUnread() {
    if (chatId) {
      try {
        await prisma.chat.update({
          where: { id: chatId },
          data: { hasUnread: true },
        });
        chatEvents.emit({ type: "chat-unread", chatId });
      } catch { /* best effort */ }
    }
  }

  // Start the run asynchronously — return the Response immediately
  executeRun(
    { objectiveId, chatId, model, signal: runAbortController.signal, attachments, skillId, pluginId },
    {
      onRunCreated: async (runId) => {
        currentRunId = runId;
        registerRun(runId, runAbortController, chatId);
        sendSSE("run_created", { runId });
        if (chatId) chatEvents.emit({ type: "run-started", chatId, runId });

        // Save an assistant message immediately so run steps are visible on
        // page refresh even if the run crashes before onComplete/onError.
        if (chatId) {
          try {
            const msg = await createMessage({
              chatId,
              role: "assistant",
              content: "",
              objectiveId,
              runId,
            });
            savedMessageId = msg.id;
          } catch {
            // Best-effort
          }
        }
      },
      onStep: (step) => {
        if (currentRunId) {
          const label = STEP_LABEL_MAP[(step as { type: string }).type];
          if (label) {
            updateRunActivity(currentRunId, label);
            if (chatId) chatEvents.emit({ type: "run-activity", chatId, label });
          }
        }
        sendSSE("step", step);
        if (chatId) chatEvents.emit({ type: "run-step", chatId, step });
      },
      onDelta: (text) => {
        accumulatedContent += text;
        sendSSE("delta", { text });
        if (chatId) chatEvents.emit({ type: "run-delta", chatId, text });
      },
      onComplete: async (runId) => {
        unregisterRun(runId);

        // Fetch artifacts early — used for both filename resolution and SSE event
        let artifacts: { id: string; filename: string; mimeType: string | null; sizeBytes: number; summary: string | null }[] = [];
        try {
          artifacts = await prisma.artifact.findMany({
            where: { runId, intermediate: false, category: { in: ["file", "data"] } },
            select: { id: true, filename: true, mimeType: true, sizeBytes: true, summary: true },
          });
        } catch {
          // Best-effort
        }

        // Resolve bare-filename image refs (e.g. ![alt](cute_fern.jpg)) to artifact URLs.
        // Models sometimes use the filename hint instead of the proper /api/artifacts/... URL.
        let finalContent = accumulatedContent || "";
        if (artifacts.length > 0) {
          const imageArtifactMap = new Map<string, string>();
          for (const a of artifacts) {
            if (a.mimeType?.startsWith("image/")) {
              imageArtifactMap.set(a.filename, `/api/artifacts/${a.id}/download?inline=1`);
            }
          }
          if (imageArtifactMap.size > 0) {
            finalContent = finalContent.replace(
              /!\[([^\]]*)\]\(([^)]+)\)/g,
              (match, alt, src) => {
                if (src.startsWith("/") || src.startsWith("http://") || src.startsWith("https://")) {
                  return match; // already a proper URL
                }
                const artifactUrl = imageArtifactMap.get(src);
                return artifactUrl ? `![${alt}](${artifactUrl})` : match;
              },
            );
          }
        }

        // Update the early-saved message with final content
        if (savedMessageId) {
          try {
            await updateMessage(savedMessageId, finalContent);
          } catch {
            // Best-effort
          }
        } else if (chatId) {
          // Fallback: create message if onRunCreated was never called
          try {
            await createMessage({
              chatId,
              role: "assistant",
              content: finalContent,
              objectiveId,
              runId,
            });
          } catch {
            // Best-effort
          }
        }

        // Forward reply to external platform (e.g. WhatsApp) if this chat is extension-linked
        if (chatId && finalContent) {
          try {
            const extChat = await prisma.extensionChat.findUnique({
              where: { chatId },
              include: { extension: true },
            });
            if (extChat?.extension.enabled && extChat.extension.type === "whatsapp") {
              const { forwardRunToWhatsApp } = await import("@/lib/extensions/whatsapp/media");
              // Look up the contact's response prefix (best-effort: use self contact for web-initiated runs)
              const contact = await prisma.channelContact.findFirst({
                where: { extensionId: extChat.extensionId },
                orderBy: { isSelf: "desc" },
              });
              const rawPrefix = contact?.responsePrefix ?? "";
              await forwardRunToWhatsApp(extChat.externalId, finalContent, runId, rawPrefix);
            }
          } catch {
            // Best-effort — don't fail the run if WhatsApp send fails
          }
        }

        // Only flag unread if the user isn't watching the chat live
        if (clientGone) await markChatUnread();

        // Send artifact info so the chat UI can render download buttons
        if (artifacts.length > 0) {
          sendSSE("artifacts", { artifacts });
        }

        if (chatId) chatEvents.emit({ type: "run-complete", chatId, runId });

        sendSSE("complete", {});
        if (!clientGone) writer.close().catch(() => {});
      },
      onError: async (error, runId) => {
        unregisterRun(runId);

        const errorContent = accumulatedContent || `Error: ${error}`;
        // Update the early-saved message with error content
        if (savedMessageId) {
          try {
            await updateMessage(savedMessageId, errorContent);
          } catch {
            // Best-effort
          }
        } else if (chatId) {
          // Fallback: create message if onRunCreated was never called
          try {
            await createMessage({
              chatId,
              role: "assistant",
              content: errorContent,
              objectiveId,
              runId,
            });
          } catch {
            // Best-effort
          }
        }

        if (clientGone) await markChatUnread();

        if (chatId) chatEvents.emit({ type: "run-error", chatId, error: String(error) });

        sendSSE("error", { error });
        if (!clientGone) writer.close().catch(() => {});
      },
    }
  ).catch(async (err) => {
    // executeRun itself threw (before its own try/catch) — update message if possible
    if (currentRunId) unregisterRun(currentRunId);
    if (savedMessageId) {
      updateMessage(savedMessageId, accumulatedContent || `Error: ${err.message}`).catch(() => {});
    }
    if (clientGone) await markChatUnread();
    sendSSE("error", { error: err.message });
    if (!clientGone) writer.close().catch(() => {});
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
