import { prisma } from "@/lib/db/prisma";
import type {
  ToolExecutorFn,
  ToolExecutionResult,
  ContextualToolExecutorFn,
} from "../types";

// ── read-user-memory ────────────────────────────────────────

export const readUserMemoryExecutor: ToolExecutorFn = async (): Promise<ToolExecutionResult> => {
  try {
    const { getUserMemory } = await import("@/lib/memory/user-memory");
    const content = await getUserMemory();
    if (!content.trim()) {
      return { success: true, output: { content: "", message: "User memory is empty" } };
    }
    return { success: true, output: { content, lineCount: content.split("\n").filter((l) => l.trim()).length } };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
};

// ── write-user-memory ───────────────────────────────────────

export const writeUserMemoryExecutor: ToolExecutorFn = async (
  input,
): Promise<ToolExecutionResult> => {
  const { content } = input;

  if (!content || typeof content !== "string") {
    return {
      success: false,
      output: null,
      error: "content (string) is required",
    };
  }

  try {
    const { appendUserMemory } = await import("@/lib/memory/user-memory");
    await appendUserMemory(content);
    return {
      success: true,
      output: { message: "User memory updated" },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
};

// ── write-tool-memory ──────────────────────────────────────────

export const writeToolMemoryExecutor: ToolExecutorFn = async (
  input,
): Promise<ToolExecutionResult> => {
  const { toolName, content } = input;

  if (!toolName || typeof toolName !== "string") {
    return { success: false, output: null, error: "toolName (string) is required" };
  }
  if (!content || typeof content !== "string") {
    return { success: false, output: null, error: "content (string) is required" };
  }

  try {
    const tool = await prisma.tool.findUnique({ where: { name: toolName } });
    if (!tool) {
      return { success: false, output: null, error: `Tool "${toolName}" not found` };
    }

    const existing = tool.memory ?? "";

    // First write — store directly
    if (!existing.trim()) {
      await prisma.tool.update({
        where: { id: tool.id },
        data: { memory: content },
      });
      return { success: true, output: { message: `Tool memory saved for "${toolName}"` } };
    }

    // Merge new facts into existing tool memory
    let finalContent: string;
    try {
      const { mergeUserMemory } = await import("@/lib/memory/compactor");
      finalContent = await mergeUserMemory(existing, content, 80);
    } catch {
      // Fallback: simple append
      finalContent = `${existing}\n\n${content}`;
    }

    await prisma.tool.update({
      where: { id: tool.id },
      data: { memory: finalContent },
    });

    return { success: true, output: { message: `Tool memory updated for "${toolName}"` } };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
};

// ── write-whatsapp-contact-memory ────────────────────────────

export const writeContactMemoryExecutorFactory: ContextualToolExecutorFn = (ctx) => {
  return async (input): Promise<ToolExecutionResult> => {
    const { content } = input;

    if (!content || typeof content !== "string") {
      return { success: false, output: null, error: "content (string) is required" };
    }

    if (!ctx.contactId) {
      return { success: false, output: null, error: "No contact context — this tool is only available in channel conversations" };
    }

    try {
      const contact = await prisma.channelContact.findUnique({ where: { id: ctx.contactId } });
      if (!contact) {
        return { success: false, output: null, error: "Contact not found" };
      }

      const current = contact.instructions;

      // First write — store directly
      if (!current.trim()) {
        await prisma.channelContact.update({
          where: { id: ctx.contactId },
          data: { instructions: content },
        });
        return { success: true, output: { message: "Contact memory saved" } };
      }

      // Merge new facts into existing contact memory
      let finalContent: string;
      try {
        const { mergeUserMemory } = await import("@/lib/memory/compactor");
        finalContent = await mergeUserMemory(current, content, 100);
      } catch {
        // Fallback: simple append
        finalContent = `${current}\n\n${content}`;
      }

      await prisma.channelContact.update({
        where: { id: ctx.contactId },
        data: { instructions: finalContent },
      });

      return { success: true, output: { message: "Contact memory updated" } };
    } catch (err) {
      return { success: false, output: null, error: (err as Error).message };
    }
  };
};
