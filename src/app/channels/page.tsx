import { ensureExtensionDefaults, getAllExtensions } from "@/lib/extensions/queries";
import { bootWhatsAppIfEnabled, whatsappGateway } from "@/lib/extensions/whatsapp/gateway";
import { prisma } from "@/lib/db/prisma";
import { serialize } from "@/lib/db/serialize";
import { ChannelsPageClient } from "./channels-page-client";

export default async function ChannelsPage() {
  await ensureExtensionDefaults();
  await bootWhatsAppIfEnabled();
  const extensions = await getAllExtensions();

  const enriched = await Promise.all(
    extensions.map(async (ext) => {
      const contactCount = await prisma.channelContact.count({
        where: { extensionId: ext.id, isSelf: false },
      });
      // Overlay live gateway status for WhatsApp (DB can be stale)
      const status = ext.type === "whatsapp" ? whatsappGateway.status : ext.status;
      return { ...ext, status, contactCount };
    }),
  );

  return <ChannelsPageClient initialData={serialize(enriched)} />;
}
