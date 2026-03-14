import { getAllExtensions } from "@/lib/extensions/queries";
import { toContactProfile } from "@/lib/extensions/contacts";
import { prisma } from "@/lib/db/prisma";
import { serialize } from "@/lib/db/serialize";
import { ContactDetailClient } from "./contact-detail-client";

function parsePhoneNumber(raw: string): string | null {
  try {
    return JSON.parse(raw).phoneNumber ?? null;
  } catch {
    return null;
  }
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;

  const extensions = await getAllExtensions();
  const wa = extensions.find((e) => e.type === "whatsapp") ?? null;

  if (!wa) {
    return (
      <ContactDetailClient
        contactId={contactId}
        initialData={{ ext: null, contact: null, phoneNumber: null }}
      />
    );
  }

  const row = await prisma.channelContact.findUnique({
    where: { id: contactId },
  });

  const contact = row && row.extensionId === wa.id ? toContactProfile(row) : null;
  const phoneNumber = parsePhoneNumber(wa.config);

  return (
    <ContactDetailClient
      contactId={contactId}
      initialData={serialize({ ext: wa, contact, phoneNumber })}
    />
  );
}
