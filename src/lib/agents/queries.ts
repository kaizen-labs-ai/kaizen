import { prisma } from "@/lib/db/prisma";
import { ensureAgentConfigs } from "./defaults";

/** Returns all system agent configs, ensuring defaults exist first. */
export async function getAllAgentConfigs() {
  await ensureAgentConfigs();
  return prisma.agentConfig.findMany({
    where: { type: "system" },
    orderBy: { id: "asc" },
  });
}

/** Returns a single agent config by ID, ensuring defaults exist first. */
export async function getAgentConfig(id: string) {
  await ensureAgentConfigs();
  return prisma.agentConfig.findUnique({ where: { id } });
}
