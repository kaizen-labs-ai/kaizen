/**
 * Vault queries — merges user secrets (VaultEntry) and integration secrets
 * (McpIntegration) into a unified list. Never exposes actual secret values.
 */
import { prisma } from "@/lib/db/prisma";
import { listSecretNames, getSecret, getSecretHint, hasSecret } from "@/lib/vault/vault";

export interface VaultListItem {
  id: string;
  vaultKey: string;
  label: string;
  hint: string | null;
  hasValue: boolean;
  category: string;
  source: "user" | "extension";
  authorizedDomains: string | null;
  description: string | null;
  fields: Record<string, string>;
  sourceLink: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseFields(raw: string): Record<string, string> {
  try { return JSON.parse(raw); } catch { return {}; }
}

export async function getVaultList(): Promise<VaultListItem[]> {
  const [userEntries, integrations] = await Promise.all([
    prisma.vaultEntry.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.mcpIntegration.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const items: VaultListItem[] = [];

  // Integration secrets (only show if API key is set)
  for (const integ of integrations) {
    const [hint, has] = await Promise.all([
      getSecretHint(integ.vaultKey),
      hasSecret(integ.vaultKey),
    ]);
    if (!has) continue;
    items.push({
      id: integ.id,
      vaultKey: integ.vaultKey,
      label: integ.name,
      hint,
      hasValue: has,
      category: "extension",
      source: "extension",
      authorizedDomains: integ.provider,
      description: null,
      fields: {},
      sourceLink: `/extensions/${integ.provider}`,
      createdAt: integ.createdAt.toISOString(),
      updatedAt: integ.updatedAt.toISOString(),
    });
  }

  // User secrets
  const REDACTED_CATEGORIES = new Set(["password", "login"]);
  for (const entry of userEntries) {
    const redact = REDACTED_CATEGORIES.has(entry.category);
    const [hint, has, encryptedDomains] = await Promise.all([
      getSecretHint(entry.vaultKey, redact),
      hasSecret(entry.vaultKey),
      getSecret(`${entry.vaultKey}_domains`),
    ]);

    // Authorized domains: vault first, fall back to DB service for unmigrated entries
    const authorizedDomains = encryptedDomains || entry.service || null;

    // Address fields are encrypted in vault — decrypt for display
    let fields: Record<string, string>;
    if (entry.category === "address") {
      const raw = await getSecret(entry.vaultKey);
      fields = raw ? JSON.parse(raw) : {};
    } else {
      fields = parseFields(entry.fields);
    }

    items.push({
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

  return items;
}

export const VALID_CATEGORIES = ["api_key", "token", "password", "login", "address", "system", "other"] as const;
export type SecretCategory = (typeof VALID_CATEGORIES)[number];
