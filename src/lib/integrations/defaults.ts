import { prisma } from "@/lib/db/prisma";

interface IntegrationCatalogEntry {
  provider: string;
  name: string;
  vaultKey: string;
  config: string;
}

const INTEGRATION_CATALOG: IntegrationCatalogEntry[] = [
  {
    provider: "zapier",
    name: "Zapier",
    vaultKey: "zapier_api_key",
    config: JSON.stringify({ mcpEndpoint: "https://mcp.zapier.com/api/v1/connect" }),
  },
  {
    provider: "brave",
    name: "Brave Search",
    vaultKey: "brave_api_key",
    config: JSON.stringify({}),
  },
];

/** Idempotent — creates missing default MCP integrations. */
export async function ensureIntegrationDefaults(): Promise<void> {
  for (const entry of INTEGRATION_CATALOG) {
    await prisma.mcpIntegration.upsert({
      where: { provider: entry.provider },
      update: {},
      create: {
        provider: entry.provider,
        name: entry.name,
        vaultKey: entry.vaultKey,
        config: entry.config,
      },
    });
  }
}

export async function getAllIntegrations() {
  return prisma.mcpIntegration.findMany({ orderBy: { createdAt: "asc" } });
}

export async function getIntegration(provider: string) {
  return prisma.mcpIntegration.findUnique({ where: { provider } });
}
