import { getAllTools } from "@/lib/tools/queries";
import { serialize } from "@/lib/db/serialize";
import { ToolsPageClient } from "./tools-page-client";

export default async function ToolsPage() {
  const tools = await getAllTools();
  return <ToolsPageClient initialData={serialize(tools)} />;
}
