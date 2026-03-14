import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { setSecret, hasSecret, getSecretHint } from "@/lib/vault/vault";

const VAULT_KEY = "openrouter_api_key";

export async function GET() {
  const has = await hasSecret(VAULT_KEY);
  const hint = has ? await getSecretHint(VAULT_KEY) : null;
  return NextResponse.json({ hasKey: has, hint });
}

export async function POST(req: Request) {
  const { key } = (await req.json()) as { key?: string };
  const trimmed = key?.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "API key is required" }, { status: 400 });
  }

  // Store encrypted value in vault
  await setSecret(VAULT_KEY, trimmed);

  // Upsert a VaultEntry row so it appears in the vault list
  await prisma.vaultEntry.upsert({
    where: { vaultKey: VAULT_KEY },
    update: {},
    create: {
      vaultKey: VAULT_KEY,
      label: "OpenRouter",
      category: "system",
      service: "openrouter.ai",
    },
  });

  const hint = await getSecretHint(VAULT_KEY);
  return NextResponse.json({ ok: true, hint });
}
