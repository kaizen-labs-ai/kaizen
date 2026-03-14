import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { setSecret, deleteSecret, getSecretHint } from "@/lib/vault/vault";
import { getVaultList, VALID_CATEGORIES } from "@/lib/vault/queries";

export async function GET() {
  const items = await getVaultList();
  return NextResponse.json(items);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { label, value, category, description, authorizedDomains, fields } = body as {
    label?: string;
    value?: string;
    category?: string;
    description?: string;
    authorizedDomains?: string;
    fields?: Record<string, string>;
  };
  const service = authorizedDomains;

  // Validate required fields
  const trimmedLabel = label?.trim();
  if (!trimmedLabel || trimmedLabel.length > 100) {
    return NextResponse.json(
      { error: "label is required (max 100 characters)" },
      { status: 400 },
    );
  }

  const cat = category ?? "other";
  if (!VALID_CATEGORIES.includes(cat as (typeof VALID_CATEGORIES)[number])) {
    return NextResponse.json(
      { error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` },
      { status: 400 },
    );
  }

  // Type-specific validation
  if (cat === "address") {
    // Address has no vault secret — all data lives in fields
    if (!fields || !fields.name?.trim()) {
      return NextResponse.json({ error: "Full name is required for address" }, { status: 400 });
    }
  } else if (cat === "login") {
    if (!value || typeof value !== "string") {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }
    if (!fields?.username?.trim()) {
      return NextResponse.json({ error: "Username/email is required for login" }, { status: 400 });
    }
  } else {
    // api_key, token, password, other — require a value
    if (!value || typeof value !== "string") {
      return NextResponse.json({ error: "value is required" }, { status: 400 });
    }
  }

  if (description && description.length > 500) {
    return NextResponse.json({ error: "description max 500 characters" }, { status: 400 });
  }
  if (service && service.length > 500) {
    return NextResponse.json({ error: "authorized domains max 500 characters" }, { status: 400 });
  }

  const vaultKey = `user_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  // Write to encrypted vault
  if (cat === "address") {
    // Address: encrypt all fields as JSON in vault (no plaintext in DB)
    await setSecret(vaultKey, JSON.stringify(fields ?? {}));
  } else if (value) {
    await setSecret(vaultKey, value);
  }

  // Store authorized domains in encrypted vault (never in plaintext DB)
  const domainsTrimmed = service?.trim() || null;
  if (domainsTrimmed) {
    await setSecret(`${vaultKey}_domains`, domainsTrimmed);
  }

  // Create DB metadata (address fields stay empty — encrypted in vault)
  // Note: service column is intentionally null — domains are in the vault
  let entry;
  try {
    entry = await prisma.vaultEntry.create({
      data: {
        vaultKey,
        label: trimmedLabel,
        category: cat,
        description: description?.trim() || null,
        service: null,
        fields: cat === "address" ? "{}" : (fields ? JSON.stringify(fields) : "{}"),
      },
    });
  } catch (err) {
    // Rollback vault write
    if (cat !== "address") {
      await deleteSecret(vaultKey).catch(() => {});
    }
    throw err;
  }

  const hint = await getSecretHint(vaultKey);

  return NextResponse.json(
    {
      id: entry.id,
      vaultKey: entry.vaultKey,
      label: entry.label,
      hint,
      hasValue: true,
      category: entry.category,
      source: "user",
      authorizedDomains: domainsTrimmed,
      description: entry.description,
      fields: fields ?? {},
      sourceLink: null,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    },
    { status: 201 },
  );
}
