import { getAllArtifacts } from "@/lib/artifacts/queries";
import { serialize } from "@/lib/db/serialize";
import { OutputsPageClient, type ArtifactItem } from "./outputs-page-client";

export default async function OutputsPage() {
  const artifacts = await getAllArtifacts();
  return <OutputsPageClient initialData={serialize(artifacts) as unknown as ArtifactItem[]} />;
}
