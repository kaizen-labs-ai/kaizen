/**
 * Cron scheduler — checks due schedules every 60 seconds and triggers
 * skill runs accordingly.
 */

import { prisma } from "@/lib/db/prisma";
import { CronExpressionParser } from "cron-parser";
import { createLog } from "@/lib/logs/logger";
import { chatEvents } from "@/lib/events/chat-events";
import { createMessage, findOrCreateExtensionChat } from "@/lib/chats/registry";
import { registerRun, updateRunActivity, unregisterRun } from "@/lib/agent/active-runs";
import { findSelfContact } from "@/lib/extensions/contacts";

interface Destination {
  type: "none" | "new_chat" | "chat" | "whatsapp";
  chatId?: string;
}

function parseDestination(raw: string): Destination {
  try {
    return JSON.parse(raw);
  } catch {
    return { type: "none" };
  }
}

const CHECK_INTERVAL_MS = 60_000;

class CronScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), CHECK_INTERVAL_MS);
    // Run first tick after a short delay to let the server finish booting
    setTimeout(() => this.tick(), 5_000);
    createLog("info", "system", "Cron scheduler started").catch(() => {});
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    if (this.running) return; // Skip if previous tick is still running
    this.running = true;

    try {
      const schedules = await prisma.schedule.findMany({
        where: { enabled: true },
      });

      if (schedules.length === 0) {
        return;
      }

      const now = new Date();

      for (const schedule of schedules) {
        try {
          const due = this.isDue(schedule.cron, schedule.lastRunAt, now);
          if (due) {
            createLog("info", "system", `Schedule "${schedule.name}" is due, executing...`).catch(() => {});
            await this.execute(schedule, now);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          createLog("error", "system", `Schedule ${schedule.id} error: ${msg}`).catch(() => {});
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      createLog("error", "system", `Scheduler tick failed: ${msg}`).catch(() => {});
    } finally {
      this.running = false;
    }
  }

  private isDue(cron: string, lastRunAt: Date | null, now: Date): boolean {
    try {
      // For */N minute crons, use interval-based timing (relative to last run)
      const minuteMatch = cron.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
      if (minuteMatch && lastRunAt) {
        const intervalMs = parseInt(minuteMatch[1]) * 60_000;
        return now.getTime() - lastRunAt.getTime() >= intervalMs;
      }

      // Standard cron-based check for all other patterns
      // When lastRunAt is null (newly created schedule), use `now` so the first
      // fire time is the next cron occurrence after creation — not epoch, which
      // would make isDue() true immediately.
      const startFrom = lastRunAt ?? now;
      const interval = CronExpressionParser.parse(cron, {
        currentDate: startFrom,
      });
      const next = interval.next().toDate();
      return next <= now;
    } catch {
      return false;
    }
  }

  private async execute(
    schedule: {
      id: string;
      targetType: string;
      skillId: string | null;
      name: string;
      destination: string;
    },
    now: Date,
  ) {
    // Update lastRunAt immediately to prevent double-firing
    await prisma.schedule.update({
      where: { id: schedule.id },
      data: { lastRunAt: now },
    });

    if (schedule.skillId) {
      await this.executeSkill(schedule as typeof schedule & { skillId: string }, now);
    }
  }

  private async executeSkill(
    schedule: { id: string; name: string; skillId: string; destination: string },
    _now: Date,
  ) {
    const { executeRun } = await import("@/lib/agent/orchestrator");
    const skill = await prisma.skill.findUnique({ where: { id: schedule.skillId } });
    if (!skill) return;

    const dest = parseDestination(schedule.destination);

    // Resolve or create the chat for output routing
    let chatId: string | null = null;
    let whatsAppJid: string | null = null;
    let whatsAppPrefix = "";

    if (dest.type === "new_chat") {
      const chat = await prisma.chat.create({
        data: { title: `[Scheduled] ${schedule.name}` },
      });
      chatId = chat.id;
      chatEvents.emit({ type: "chat-created", chatId: chat.id });
    } else if (dest.type === "chat" && dest.chatId) {
      chatId = dest.chatId;
    } else if (dest.type === "whatsapp") {
      // Route through the Kaizen WhatsApp self-chat mirror so the run
      // appears in both the Kaizen UI and the WhatsApp thread.
      const resolved = await this.resolveWhatsAppSelfChat();
      if (resolved) {
        chatId = resolved.chatId;
        whatsAppJid = resolved.jid;
        whatsAppPrefix = resolved.responsePrefix;
      }
    }

    const objective = await prisma.objective.create({
      data: {
        title: `[Scheduled] ${schedule.name}`,
        description: `Scheduled execution of skill "${skill.name}"`,
        skillId: skill.id,
        phase: "executing",
      },
    });

    // Store the trigger message in the chat + forward to WhatsApp
    // Chat: icon marker (\x03scheduled\x03) + styled skill name (\x01...\x02)
    // WhatsApp: plain text fallback (no icons in WhatsApp threads)
    const chatTriggerText = `\x03scheduled\x03\x01${skill.name}\x02`;
    const whatsAppTriggerText = `[Scheduled run] ${skill.name}`;
    if (chatId) {
      await createMessage({
        chatId,
        role: "user",
        content: chatTriggerText,
        objectiveId: objective.id,
      });
      chatEvents.emit({ type: "trigger-message", chatId, content: chatTriggerText });
    }
    if (whatsAppJid) {
      const { whatsappGateway } = await import("@/lib/extensions/whatsapp/gateway");
      await whatsappGateway.sendMessage(whatsAppJid, whatsAppTriggerText).catch(() => {});
    }

    let accumulated = "";
    let currentRunId: string | null = null;
    const runAbortController = new AbortController();

    executeRun(
      { objectiveId: objective.id, skillId: skill.id },
      {
        onRunCreated: async (runId) => {
          currentRunId = runId;
          if (chatId) {
            registerRun(runId, runAbortController, chatId);
            chatEvents.emit({ type: "run-started", chatId, runId });
            await createMessage({
              chatId,
              role: "assistant",
              content: "",
              objectiveId: objective.id,
              runId,
            }).catch(() => {});
          }
        },
        onStep: async (step) => {
          if (chatId) {
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
          }
        },
        onDelta: async (text) => {
          accumulated += text;
          if (chatId) {
            chatEvents.emit({ type: "run-delta", chatId, text });
          }
        },
        onComplete: async (runId) => {
          if (chatId) {
            unregisterRun(runId);

            const reply = accumulated.trim();
            if (reply) {
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
            }

            chatEvents.emit({ type: "run-complete", chatId, runId });
            chatEvents.emit({ type: "chat-unread", chatId });
          }

          // Forward to WhatsApp via the same path as the message handler
          if (whatsAppJid && accumulated.trim()) {
            const { forwardRunToWhatsApp } = await import("@/lib/extensions/whatsapp/media");
            await forwardRunToWhatsApp(whatsAppJid, accumulated.trim(), currentRunId, whatsAppPrefix).catch((err) => {
              createLog("warn", "system", `Failed to forward schedule output to WhatsApp: ${(err as Error).message}`).catch(() => {});
            });
          }

          createLog("info", "system", `Schedule "${schedule.name}" completed skill run`).catch(() => {});
        },
        onError: async (error) => {
          if (currentRunId) unregisterRun(currentRunId);

          if (chatId) {
            const lastMsg = await prisma.message.findFirst({
              where: { chatId, role: "assistant", objectiveId: objective.id },
              orderBy: { createdAt: "desc" },
            });
            if (lastMsg) {
              await prisma.message.update({
                where: { id: lastMsg.id },
                data: { content: `Schedule failed: ${error}` },
              }).catch(() => {});
            }

            chatEvents.emit({ type: "run-error", chatId, error: String(error) });
          }

          createLog("error", "system", `Schedule "${schedule.name}" skill run failed: ${error}`).catch(() => {});
        },
      },
    ).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      createLog("error", "system", `Schedule "${schedule.name}" execution error: ${msg}`).catch(() => {});
    });
  }

  /** Resolve the Kaizen mirror chat + JID for the WhatsApp self-chat. */
  private async resolveWhatsAppSelfChat(): Promise<{ chatId: string; jid: string; responsePrefix: string } | null> {
    try {
      const ext = await prisma.extension.findUnique({ where: { type: "whatsapp" } });
      if (!ext || !ext.enabled) return null;

      const selfContact = await findSelfContact(ext.id);
      if (!selfContact || !selfContact.enabled) return null;

      const { whatsappGateway } = await import("@/lib/extensions/whatsapp/gateway");
      // Prefer LID for self-chat — modern WhatsApp uses LID-based addressing.
      // sock.user.lid may include a device suffix (e.g. "88807173009411:4@lid"),
      // but self-chat needs just "88807173009411@lid".
      const rawLid = whatsappGateway.getUserLid();
      const lid = rawLid ? rawLid.replace(/:\d+@/, "@") : null;
      const jid = lid || whatsappGateway.getUserJid();
      if (!jid) return null;

      const { chatId, isNew } = await findOrCreateExtensionChat(ext.id, jid, "WhatsApp: Self");
      if (isNew) chatEvents.emit({ type: "chat-created", chatId });

      return { chatId, jid, responsePrefix: selfContact.responsePrefix || "" };
    } catch (err) {
      createLog("warn", "system", `Failed to resolve WhatsApp self-chat: ${(err as Error).message}`).catch(() => {});
      return null;
    }
  }
}

// Singleton via globalThis (survives HMR)
const globalForScheduler = globalThis as unknown as { _cronScheduler?: CronScheduler };

export function getScheduler(): CronScheduler {
  if (!globalForScheduler._cronScheduler) {
    globalForScheduler._cronScheduler = new CronScheduler();
  }
  return globalForScheduler._cronScheduler;
}

export function bootScheduler() {
  getScheduler().start();
}
