import { getAgentConfig } from "@/lib/agents/queries";
import { serialize } from "@/lib/db/serialize";
import { AgentDetailClient } from "./agent-detail-client";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = await getAgentConfig(id);
  return <AgentDetailClient initialData={agent ? serialize(agent) : null} id={id} />;
}
