import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSecret, setSecret, deleteSecret, getSecretHint, hasSecret } from "@/lib/vault/vault";
import { VALID_CATEGORIES } from "@/lib/vault/queries";

type Params = { params: Promise<{ id: string }> };

function parseFields(raw: string): Record<string, string> {
  try { return JSON.parse(raw); } catch { return {}; }
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const entry = await prisma.vaultEntry.findUnique({ where: { id } });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const redact = entry.category === "password" || entry.category === "login";
  const [hint, has, encryptedDomains] = await Promise.all([
    getSecretHint(entry.vaultKey, redact),
    hasSecret(entry.vaultKey),
    getSecret(`${entry.vaultKey}_domains`),
  ]);

  // Authorized domains: vault first, fall back to DB service for unmigrated entries
  const authorizedDomains = encryptedDomains || entry.service || null;

  // For address entries, decrypt fields from vault (not stored in DB)
  let fields: Record<string, string>;
  if (entry.category === "address") {
    const raw = await getSecret(entry.vaultKey);
    fields = raw ? JSON.parse(raw) : {};
  } else {
    fields = parseFields(entry.fields);
  }

  return NextResponse.json({
    id: entry.id,
    vaultKey: entry.vaultKey,
    label: entry.label,
    hint,
    hasValue: has,
    category: entry.category,
    source: "user",
    authorizedDomains,
    description: entry.description,
    fields,
    sourceLink: null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  });
}

export async function PUT(req: Request, { params }: Params) {
  const { id } = await params;
  const entry = await prisma.vaultEntry.findUnique({ where: { id } });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { label, description, category, authorizedDomains, value, fields } = body as {
    label?: string;
    description?: string;
    category?: string;
    authorizedDomains?: string;
    value?: string;
    fields?: Record<string, string>;
  };
  const service = authorizedDomains;

  // Validate
  if (label !== undefined && (!label.trim() || label.trim().length > 100)) {
    return NextResponse.json({ error: "label must be 1-100 characters" }, { status: 400 });
  }
  if (category !== undefined && !VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
    return NextResponse.json(
      { error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` },
      { status: 400 },
    );
  }
  if (description !== undefined && description.length > 500) {
    return NextResponse.json({ error: "description max 500 characters" }, { status: 400 });
  }
  if (service !== undefined && service.length > 500) {
    return NextResponse.json({ error: "authorized domains max 500 characters" }, { status: 400 });
  }

  // Rotate secret value if provided
  if (value && typeof value === "string") {
    await setSecret(entry.vaultKey, value);
  }

  // For address: encrypt fields in vault (never store plaintext in DB)
  if (entry.category === "address" && fields !== undefined) {
    await setSecret(entry.vaultKey, JSON.stringify(fields));
  }

  // Store authorized domains in encrypted vault (never in plaintext DB)
  if (service !== undefined) {
    const domainsTrimmed = service.trim() || null;
    if (domainsTrimmed) {
      await setSecret(`${entry.vaultKey}_domains`, domainsTrimmed);
    } else {
      // Domains cleared — remove from vault
      await deleteSecret(`${entry.vaultKey}_domains`);
    }
  }

  // Update DB metadata
  // Note: service column cleared — domains live in the vault now
  const data: Record<string, unknown> = {};
  if (label !== undefined) data.label = label.trim();
  if (description !== undefined) data.description = description.trim() || null;
  if (category !== undefined) data.category = category;
  if (service !== undefined) data.service = null;
  // Address fields are encrypted in vault — keep DB fields empty
  if (fields !== undefined && entry.category !== "address") data.fields = JSON.stringify(fields);

  const updated = await prisma.vaultEntry.update({ where: { id }, data });
  const redactUpdated = updated.category === "password" || updated.category === "login";
  const [hint, has, updatedEncDomains] = await Promise.all([
    getSecretHint(updated.vaultKey, redactUpdated),
    hasSecret(updated.vaultKey),
    getSecret(`${updated.vaultKey}_domains`),
  ]);

  // For address: decrypt fields from vault for the response
  let updatedFields: Record<string, string>;
  if (updated.category === "address") {
    const raw = await getSecret(updated.vaultKey);
    updatedFields = raw ? JSON.parse(raw) : {};
  } else {
    updatedFields = parseFields(updated.fields);
  }

  return NextResponse.json({
    id: updated.id,
    vaultKey: updated.vaultKey,
    label: updated.label,
    hint,
    hasValue: has,
    category: updated.category,
    source: "user",
    authorizedDomains: updatedEncDomains || null,
    description: updated.description,
    fields: updatedFields,
    sourceLink: null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const entry = await prisma.vaultEntry.findUnique({ where: { id } });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Delete from vault first (both secret value and domains), then DB
  await Promise.all([
    deleteSecret(entry.vaultKey),
    deleteSecret(`${entry.vaultKey}_domains`),
  ]);
  await prisma.vaultEntry.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
