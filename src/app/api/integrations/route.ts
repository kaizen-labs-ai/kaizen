import { NextResponse } from "next/server";
import { ensureIntegrationDefaults, getAllIntegrations } from "@/lib/integrations/defaults";
import { hasSecret, getSecretHint } from "@/lib/vault/vault";

export async function GET() {
  await ensureIntegrationDefaults();
  const integrations = await getAllIntegrations();

  const enriched = await Promise.all(
    integrations.map(async (i) => ({
      ...i,
      hasKey: await hasSecret(i.vaultKey),
      keyHint: await getSecretHint(i.vaultKey),
    })),
  );

  return NextResponse.json(enriched);
}
