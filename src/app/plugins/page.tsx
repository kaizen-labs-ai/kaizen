import { getAllPlugins } from "@/lib/plugins/queries";
import { serialize } from "@/lib/db/serialize";
import { PluginsPageClient, type PluginItem } from "./plugins-page-client";

export default async function PluginsPage() {
  const plugins = await getAllPlugins();
  return <PluginsPageClient initialData={serialize(plugins) as unknown as PluginItem[]} />;
}
