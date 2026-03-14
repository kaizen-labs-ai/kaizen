import { prisma } from "@/lib/db/prisma";
import { getSecret, getSecretHint, hasSecret } from "@/lib/vault/vault";
import { notFound } from "next/navigation";
import { VaultDetailClient } from "./vault-detail-client";

export default async function VaultDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entry = await prisma.vaultEntry.findUnique({ where: { id } });
  if (!entry) notFound();

  const redact = entry.category === "password" || entry.category === "login";
  const [hint, has, encryptedDomains] = await Promise.all([
    getSecretHint(entry.vaultKey, redact),
    hasSecret(entry.vaultKey),
    getSecret(`${entry.vaultKey}_domains`),
  ]);

  // Authorized domains: vault first, fall back to DB service for unmigrated entries
  const authorizedDomains = encryptedDomains || entry.service || null;

  return (
    <VaultDetailClient
      initialData={{
        id: entry.id,
        vaultKey: entry.vaultKey,
        label: entry.label,
        hint,
        hasValue: has,
        category: entry.category,
        source: "user" as const,
        authorizedDomains,
        description: entry.description,
        fields: entry.category === "address"
          ? JSON.parse((await getSecret(entry.vaultKey)) || "{}")
          : JSON.parse(entry.fields || "{}"),
        sourceLink: null,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      }}
    />
  );
}
