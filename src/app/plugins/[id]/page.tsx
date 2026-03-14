import { getPluginDetail } from "@/lib/plugins/queries";
import { serialize } from "@/lib/db/serialize";
import { PluginDetailClient } from "./plugin-detail-client";
import type { PluginDetail } from "./plugin-detail-client";

export default async function PluginDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const plugin = await getPluginDetail(id);
  return <PluginDetailClient initialData={plugin ? serialize(plugin) as unknown as PluginDetail : null} id={id} />;
}
