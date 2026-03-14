import { getAllAgentConfigs } from "@/lib/agents/queries";
import { serialize } from "@/lib/db/serialize";
import { AgentsPageClient } from "./agents-page-client";

export default async function AgentsListPage() {
  const agents = await getAllAgentConfigs();
  return <AgentsPageClient initialData={serialize(agents)} />;
}
