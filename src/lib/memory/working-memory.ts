import { prisma } from "@/lib/db/prisma";

export async function getLatestWorkingMemory(objectiveId: string): Promise<string> {
  const latest = await prisma.workingMemory.findFirst({
    where: { objectiveId },
    orderBy: { runSequence: "desc" },
  });
  return latest?.content ?? "";
}

export async function saveWorkingMemory(
  objectiveId: string,
  runSequence: number,
  content: string
): Promise<void> {
  await prisma.workingMemory.upsert({
    where: { objectiveId_runSequence: { objectiveId, runSequence } },
    update: { content },
    create: { objectiveId, runSequence, content },
  });
}
