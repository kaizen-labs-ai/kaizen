import { prisma } from "@/lib/db/prisma";

/** Returns all artifacts with related run and objective. */
export async function getAllArtifacts() {
  return prisma.artifact.findMany({
    include: {
      run: {
        include: {
          objective: {
            select: { id: true, title: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
