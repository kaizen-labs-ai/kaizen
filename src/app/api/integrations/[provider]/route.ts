import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { hasSecret, getSecretHint } from "@/lib/vault/vault";

type Params = { params: Promise<{ provider: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  const integration = await prisma.mcpIntegration.findUnique({ where: { provider } });
  if (!integration) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...integration,
    hasKey: await hasSecret(integration.vaultKey),
    keyHint: await getSecretHint(integration.vaultKey),
  });
}

export async function PUT(req: Request, { params }: Params) {
  const { provider } = await params;
  const body = await req.json();

  const integration = await prisma.mcpIntegration.findUnique({ where: { provider } });
  if (!integration) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.mcpIntegration.update({
    where: { provider },
    data: {
      enabled: body.enabled ?? integration.enabled,
      config: body.config ?? integration.config,
    },
  });

  return NextResponse.json(updated);
}
