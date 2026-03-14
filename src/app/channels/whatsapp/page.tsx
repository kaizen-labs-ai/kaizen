import { ensureExtensionDefaults, getAllExtensions } from "@/lib/extensions/queries";
import { bootWhatsAppIfEnabled, whatsappGateway } from "@/lib/extensions/whatsapp/gateway";
import { ensureSelfContact, getContacts } from "@/lib/extensions/contacts";
import { serialize } from "@/lib/db/serialize";
import { WhatsAppClient } from "./whatsapp-client";

export default async function WhatsAppPage() {
  await ensureExtensionDefaults();
  await bootWhatsAppIfEnabled();

  const extensions = await getAllExtensions();
  const wa = extensions.find((e) => e.type === "whatsapp") ?? null;

  // Overlay live gateway status (DB can be stale after server restart)
  if (wa) wa.status = whatsappGateway.status;

  let contacts: unknown[] = [];
  if (wa) {
    await ensureSelfContact(wa.id);
    contacts = await getContacts(wa.id);
  }

  return (
    <WhatsAppClient
      initialData={{
        extension: wa ? serialize(wa) : null,
        contacts: serialize(contacts),
      }}
    />
  );
}
