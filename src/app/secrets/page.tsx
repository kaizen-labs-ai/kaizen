import { getVaultList } from "@/lib/vault/queries";
import { VaultPageClient } from "./vault-page-client";

export default async function VaultPage() {
  const items = await getVaultList();
  return <VaultPageClient initialData={items} />;
}
