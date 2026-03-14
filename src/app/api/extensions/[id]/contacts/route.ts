import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  ensureSelfContact,
  getContacts,
  migrateAllowedNumbers,
  DEFAULT_PERMISSIONS,
  toContactProfile,
} from "@/lib/extensions/contacts";

/** GET /api/extensions/[id]/contacts — list contacts (auto-migrates old allowedNumbers). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ext = await prisma.extension.findUnique({ where: { id } });
  if (!ext) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Ensure self contact exists
  await ensureSelfContact(ext.id);

  // One-time migration: convert legacy allowedNumbers → ChannelContact rows
  try {
    const config = JSON.parse(ext.config);
    // Strip old bracket format "[Kaizen] " → "Kaizen"
    const rawLegacy = config.responsePrefix ?? "Kaizen";
    const legacyPrefix = rawLegacy.replace(/^\[(.+?)\]\s*$/, "$1");
    if (Array.isArray(config.allowedNumbers) && config.allowedNumbers.length > 0) {
      await migrateAllowedNumbers(ext.id, config.allowedNumbers, { responsePrefix: legacyPrefix });
      // Clear the old array from config
      config.allowedNumbers = [];
      await prisma.extension.update({
        where: { id: ext.id },
        data: { config: JSON.stringify(config) },
      });
    }
  } catch { /* config parse failure — not critical */ }

  const contacts = await getContacts(ext.id);
  return NextResponse.json(contacts);
}

/** POST /api/extensions/[id]/contacts — create a new contact. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ext = await prisma.extension.findUnique({ where: { id } });
  if (!ext) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const externalId = (body.externalId ?? "").replace(/\D/g, "");
  if (!externalId) {
    return NextResponse.json({ error: "externalId required" }, { status: 400 });
  }

  // Check for duplicates
  const existing = await prisma.channelContact.findUnique({
    where: { extensionId_externalId: { extensionId: ext.id, externalId } },
  });
  if (existing) {
    return NextResponse.json({ error: "Contact already exists" }, { status: 409 });
  }

  const row = await prisma.channelContact.create({
    data: {
      extensionId: ext.id,
      externalId,
      name: body.name ?? `+${externalId}`,
      enabled: body.enabled ?? false,
      isSelf: false,
      soulId: body.soulId ?? null,
      model: body.model ?? null,
      instructions: body.instructions ?? "",
      responsePrefix: body.responsePrefix ?? "Kaizen",
      permissions: JSON.stringify(body.permissions ?? DEFAULT_PERMISSIONS),
    },
  });

  return NextResponse.json(toContactProfile(row), { status: 201 });
}
