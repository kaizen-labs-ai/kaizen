import { ensureIntegrationDefaults, getIntegration } from "@/lib/integrations/defaults";
import { hasSecret, getSecretHint } from "@/lib/vault/vault";
import { prisma } from "@/lib/db/prisma";
import { serialize } from "@/lib/db/serialize";
import { ZapierClient } from "./zapier-client";

export default async function ZapierPage() {
  await ensureIntegrationDefaults();

  const integration = await getIntegration("zapier");
  const tools = await prisma.tool.findMany({
    where: { createdBy: "zapier" },
    orderBy: { name: "asc" },
  });

  const enriched = integration
    ? {
        ...integration,
        hasKey: await hasSecret(integration.vaultKey),
        keyHint: await getSecretHint(integration.vaultKey),
      }
    : null;

  return (
    <ZapierClient
      initialData={{
        integration: enriched ? serialize(enriched) : null,
        tools: serialize(tools),
      }}
    />
  );
}
