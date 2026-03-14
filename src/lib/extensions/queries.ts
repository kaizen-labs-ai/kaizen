import { prisma } from "@/lib/db/prisma";

const EXTENSION_CATALOG = [
  {
    type: "whatsapp",
    name: "WhatsApp",
    config: JSON.stringify({
      phoneNumber: null,
      selfChatOnly: true,
      allowedNumbers: [],
      responsePrefix: "[Kaizen] ",
      model: null,
    }),
  },
];

/** Ensure default extension records exist in DB. */
export async function ensureExtensionDefaults() {
  for (const ext of EXTENSION_CATALOG) {
    const existing = await prisma.extension.findUnique({ where: { type: ext.type } });
    if (!existing) {
      await prisma.extension.create({
        data: {
          type: ext.type,
          name: ext.name,
          config: ext.config,
        },
      });
    }
  }
}

/** Returns all extensions, ordered by creation date. */
export async function getAllExtensions() {
  return prisma.extension.findMany({
    orderBy: { createdAt: "asc" },
  });
}
