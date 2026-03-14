import { NextResponse } from "next/server";
import { bootWhatsAppIfEnabled, whatsappGateway } from "@/lib/extensions/whatsapp/gateway";
import { ensureExtensionDefaults, getAllExtensions } from "@/lib/extensions/queries";

export async function GET() {
  await ensureExtensionDefaults();
  // Boot WhatsApp if previously enabled — awaits connection settling
  // so the response always contains the definitive status (no polling needed).
  await bootWhatsAppIfEnabled();
  const extensions = await getAllExtensions();

  // Overlay the gateway's live in-memory status for WhatsApp.
  // The DB status can be stale (e.g. "connecting" written during boot
  // while the actual connection completed seconds later).
  const wa = extensions.find((e) => e.type === "whatsapp");
  if (wa) {
    wa.status = whatsappGateway.status;
  }

  return NextResponse.json(extensions);
}
