import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toContactProfile } from "@/lib/extensions/contacts";

type Params = { params: Promise<{ id: string; contactId: string }> };

/** GET /api/extensions/[id]/contacts/[contactId] — get a single contact. */
export async function GET(_req: Request, { params }: Params) {
  const { id, contactId } = await params;

  const ext = await prisma.extension.findUnique({ where: { id } });
  if (!ext) return NextResponse.json({ error: "Extension not found" }, { status: 404 });

  const row = await prisma.channelContact.findUnique({ where: { id: contactId } });
  if (!row || row.extensionId !== ext.id) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  return NextResponse.json(toContactProfile(row));
}

/** PATCH /api/extensions/[id]/contacts/[contactId] — update a contact. */
export async function PATCH(req: Request, { params }: Params) {
  const { id, contactId } = await params;

  const ext = await prisma.extension.findUnique({ where: { id } });
  if (!ext) return NextResponse.json({ error: "Extension not found" }, { status: 404 });

  const existing = await prisma.channelContact.findUnique({ where: { id: contactId } });
  if (!existing || existing.extensionId !== ext.id) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) data.name = body.name;
  if (body.enabled !== undefined) data.enabled = body.enabled;
  if (body.soulId !== undefined) data.soulId = body.soulId || null;
  if (body.model !== undefined) data.model = body.model || null;
  if (body.customSoul !== undefined) data.customSoul = body.customSoul;
  if (body.instructions !== undefined) data.instructions = body.instructions;
  if (body.responsePrefix !== undefined) data.responsePrefix = body.responsePrefix;
  if (body.permissions !== undefined) {
    data.permissions = typeof body.permissions === "string"
      ? body.permissions
      : JSON.stringify(body.permissions);
  }

  const row = await prisma.channelContact.update({
    where: { id: contactId },
    data,
  });

  return NextResponse.json(toContactProfile(row));
}

/** DELETE /api/extensions/[id]/contacts/[contactId] — delete a contact. */
export async function DELETE(_req: Request, { params }: Params) {
  const { id, contactId } = await params;

  const ext = await prisma.extension.findUnique({ where: { id } });
  if (!ext) return NextResponse.json({ error: "Extension not found" }, { status: 404 });

  const existing = await prisma.channelContact.findUnique({ where: { id: contactId } });
  if (!existing || existing.extensionId !== ext.id) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  // Prevent deleting self contact
  if (existing.isSelf) {
    return NextResponse.json({ error: "Cannot delete self contact" }, { status: 400 });
  }

  await prisma.channelContact.delete({ where: { id: contactId } });
  return NextResponse.json({ ok: true });
}
