import { ensureIntegrationDefaults, getIntegration } from "@/lib/integrations/defaults";
import { hasSecret, getSecretHint } from "@/lib/vault/vault";
import { serialize } from "@/lib/db/serialize";
import { BraveClient } from "./brave-client";

export default async function BravePage() {
  await ensureIntegrationDefaults();

  const integration = await getIntegration("brave");

  const enriched = integration
    ? {
        ...integration,
        hasKey: await hasSecret(integration.vaultKey),
        keyHint: await getSecretHint(integration.vaultKey),
      }
    : null;

  return <BraveClient initialData={enriched ? serialize(enriched) : null} />;
}
