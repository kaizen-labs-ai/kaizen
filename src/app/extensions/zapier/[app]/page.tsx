import { prisma } from "@/lib/db/prisma";
import { serialize } from "@/lib/db/serialize";
import { AppToolsClient } from "./app-tools-client";

export default async function AppToolsPage({
  params,
}: {
  params: Promise<{ app: string }>;
}) {
  const { app } = await params;

  const tools = await prisma.tool.findMany({
    where: {
      createdBy: "zapier",
      name: { startsWith: `zapier_${app}_` },
    },
    orderBy: { name: "asc" },
  });

  return <AppToolsClient app={app} initialData={serialize(tools)} />;
}
