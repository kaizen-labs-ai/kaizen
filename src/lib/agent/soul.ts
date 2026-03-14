import { prisma } from "@/lib/db/prisma";

export { DEFAULT_SOUL_NAME, DEFAULT_SOUL_DESCRIPTION, DEFAULT_SOUL_TRAITS } from "./soul-defaults";

export async function getActiveSoul() {
  const soul = await prisma.soul.findFirst({ where: { isActive: true } });
  if (!soul) {
    const first = await prisma.soul.findFirst();
    if (first) {
      await prisma.soul.update({ where: { id: first.id }, data: { isActive: true } });
      return first;
    }
    return null;
  }
  return soul;
}

export async function setActiveSoul(soulId: string) {
  await prisma.$transaction([
    prisma.soul.updateMany({ data: { isActive: false } }),
    prisma.soul.update({ where: { id: soulId }, data: { isActive: true } }),
  ]);
}

export async function getAllSouls() {
  return prisma.soul.findMany({ orderBy: { createdAt: "asc" } });
}

export async function upsertSoul(data: {
  id?: string;
  name: string;
  description: string;
  traits: string;
}) {
  if (data.id) {
    return prisma.soul.update({
      where: { id: data.id },
      data: { name: data.name, description: data.description, traits: data.traits },
    });
  }
  return prisma.soul.create({
    data: { name: data.name, description: data.description, traits: data.traits },
  });
}

export async function deleteSoul(id: string) {
  return prisma.soul.delete({ where: { id } });
}
