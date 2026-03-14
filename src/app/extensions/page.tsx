import { ensureIntegrationDefaults, getAllIntegrations } from "@/lib/integrations/defaults";
import { hasSecret, getSecretHint } from "@/lib/vault/vault";
import { serialize } from "@/lib/db/serialize";
import { ExtensionsPageClient } from "./extensions-page-client";

export default async function ExtensionsPage() {
  await ensureIntegrationDefaults();
  const integrations = await getAllIntegrations();

  const enriched = await Promise.all(
    integrations.map(async (i) => ({
      ...i,
      hasKey: await hasSecret(i.vaultKey),
      keyHint: await getSecretHint(i.vaultKey),
    })),
  );

  return <ExtensionsPageClient initialData={serialize(enriched)} />;
}
