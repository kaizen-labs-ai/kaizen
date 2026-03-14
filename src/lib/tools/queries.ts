import { prisma } from "@/lib/db/prisma";

/** Returns all non-plugin tools, ordered by name. */
export async function getAllTools() {
  return prisma.tool.findMany({
    where: { type: { not: "plugin" } },
    orderBy: { name: "asc" },
  });
}

/** Returns a single tool by ID. */
export async function getToolById(id: string) {
  return prisma.tool.findUnique({ where: { id } });
}
