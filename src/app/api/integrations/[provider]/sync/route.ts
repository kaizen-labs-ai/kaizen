import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { hasSecret } from "@/lib/vault/vault";
import { syncZapierTools } from "@/lib/integrations/zapier-sync";

type Params = { params: Promise<{ provider: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { provider } = await params;
  const integration = await prisma.mcpIntegration.findUnique({ where: { provider } });
  if (!integration) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!integration.enabled || !(await hasSecret(integration.vaultKey))) {
    return NextResponse.json(
      { error: "Integration is not connected" },
      { status: 400 },
    );
  }

  let result: { synced: number; disabled: number; error?: string } = { synced: 0, disabled: 0 };
  if (provider === "zapier") {
    result = await syncZapierTools();
  }

  if (result.error) {
    return NextResponse.json({ success: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    synced: result.synced,
    disabled: result.disabled,
  });
}
