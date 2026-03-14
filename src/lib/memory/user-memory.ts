import { prisma } from "@/lib/db/prisma";

const MAX_MEMORY_LINES = 200;

export async function getUserMemory(): Promise<string> {
  const mem = await prisma.userMemory.findUnique({ where: { id: "singleton" } });
  return mem?.content ?? "";
}

export async function appendUserMemory(newFacts: string): Promise<string> {
  const current = await getUserMemory();

  // First write -- store directly, no merge needed
  if (!current.trim()) {
    await prisma.userMemory.upsert({
      where: { id: "singleton" },
      update: { content: newFacts },
      create: { id: "singleton", content: newFacts },
    });
    return newFacts;
  }

  // Always merge new facts into existing memory (deduplicates + consolidates)
  let finalContent: string;
  try {
    const { mergeUserMemory } = await import("@/lib/memory/compactor");
    finalContent = await mergeUserMemory(current, newFacts, MAX_MEMORY_LINES);
  } catch {
    // Fallback: simple append if merge fails
    const combined = `${current}\n\n${newFacts}`;
    const lines = combined.split("\n");
    finalContent = lines.length > MAX_MEMORY_LINES
      ? lines.slice(-MAX_MEMORY_LINES).join("\n")
      : combined;
  }

  await prisma.userMemory.upsert({
    where: { id: "singleton" },
    update: { content: finalContent },
    create: { id: "singleton", content: finalContent },
  });

  return finalContent;
}

export async function setUserMemory(content: string): Promise<void> {
  await prisma.userMemory.upsert({
    where: { id: "singleton" },
    update: { content },
    create: { id: "singleton", content },
  });
}
