import { getToolById } from "@/lib/tools/queries";
import { serialize } from "@/lib/db/serialize";
import { ToolDetailClient } from "./tool-detail-client";

export default async function ToolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tool = await getToolById(id);
  return <ToolDetailClient initialData={tool ? serialize(tool) : null} id={id} />;
}
