import { prisma } from "@/lib/db/prisma";

const EXTENSION_TOOLS: Record<string, string[]> = {
  brave: [
    "brave-search",
    "brave-instant",
    "brave-image-search",
    "brave-news-search",
    "brave-video-search",
  ],
};

/** Returns all non-plugin tools, hiding extension tools when their integration is disconnected. */
export async function getAllTools() {
  const integrations = await prisma.mcpIntegration.findMany({
    select: { provider: true, status: true },
  });

  const hiddenNames: string[] = [];
  for (const [provider, toolNames] of Object.entries(EXTENSION_TOOLS)) {
    const integration = integrations.find((i) => i.provider === provider);
    if (!integration || integration.status !== "connected") {
      hiddenNames.push(...toolNames);
    }
  }

  return prisma.tool.findMany({
    where: {
      type: { not: "plugin" },
      ...(hiddenNames.length > 0 && { name: { notIn: hiddenNames } }),
    },
    orderBy: { name: "asc" },
  });
}

/** Returns a single tool by ID. */
export async function getToolById(id: string) {
  return prisma.tool.findUnique({ where: { id } });
}
