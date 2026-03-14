import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { deleteSecret } from "@/lib/vault/vault";
import { resetZapierClient } from "@/lib/mcp/zapier-client";
import { removeAllZapierTools } from "@/lib/integrations/zapier-sync";

type Params = { params: Promise<{ provider: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { provider } = await params;
  const integration = await prisma.mcpIntegration.findUnique({ where: { provider } });
  if (!integration) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Clean up: close client, remove/disable tools, delete vault key
  if (provider === "zapier") {
    await resetZapierClient();
    await removeAllZapierTools();
  }
  if (provider === "brave") {
    const braveToolNames = ["brave-search", "brave-instant", "brave-image-search", "brave-news-search", "brave-video-search"];
    await prisma.tool.updateMany({
      where: { name: { in: braveToolNames } },
      data: { enabled: false },
    });
  }
  await deleteSecret(integration.vaultKey);

  await prisma.mcpIntegration.update({
    where: { provider },
    data: { enabled: false, status: "disconnected", statusMsg: null },
  });

  return NextResponse.json({ success: true });
}
