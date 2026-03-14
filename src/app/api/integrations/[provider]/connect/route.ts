import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { setSecret } from "@/lib/vault/vault";
import { resetZapierClient } from "@/lib/mcp/zapier-client";
import { syncZapierTools } from "@/lib/integrations/zapier-sync";

type Params = { params: Promise<{ provider: string }> };

/** Validate a Brave Search API key by making a lightweight test query. */
async function validateBraveKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.search.brave.com/res/v1/web/search?q=test&count=1", {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": apiKey,
      },
    });
    if (res.ok) return { valid: true };
    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: "Invalid API key" };
    }
    return { valid: false, error: `Brave API returned ${res.status}` };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

export async function POST(req: Request, { params }: Params) {
  const { provider } = await params;
  const body = await req.json();
  const { apiKey } = body as { apiKey?: string };

  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
    return NextResponse.json({ error: "API key is required" }, { status: 400 });
  }

  const integration = await prisma.mcpIntegration.findUnique({ where: { provider } });
  if (!integration) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    // Validate key before storing (provider-specific)
    if (provider === "brave") {
      const validation = await validateBraveKey(apiKey.trim());
      if (!validation.valid) {
        return NextResponse.json(
          { success: false, error: validation.error || "Invalid API key" },
          { status: 400 },
        );
      }
    }

    // Store API key in encrypted vault
    await setSecret(integration.vaultKey, apiKey.trim());

    // Provider-specific post-connect actions
    if (provider === "zapier") {
      await resetZapierClient();
    }

    // Enable integration
    await prisma.mcpIntegration.update({
      where: { provider },
      data: { enabled: true, status: "connecting", statusMsg: provider === "zapier" ? "Syncing tools..." : null },
    });

    // Sync tools from remote (Zapier-specific — Brave uses static builtin tools)
    let syncResult: { synced: number; disabled: number; error?: string } = { synced: 0, disabled: 0 };
    if (provider === "zapier") {
      syncResult = await syncZapierTools();
    }

    if (syncResult.error) {
      return NextResponse.json(
        { success: false, error: syncResult.error },
        { status: 502 },
      );
    }

    // For non-syncing providers (Brave), mark as connected and enable tools
    if (provider !== "zapier") {
      await prisma.mcpIntegration.update({
        where: { provider },
        data: { enabled: true, status: "connected", statusMsg: null },
      });
    }

    // Enable Brave tools now that the API key is connected
    if (provider === "brave") {
      const braveToolNames = ["brave-search", "brave-instant", "brave-image-search", "brave-news-search", "brave-video-search"];
      await prisma.tool.updateMany({
        where: { name: { in: braveToolNames } },
        data: { enabled: true },
      });
    }

    return NextResponse.json({
      success: true,
      synced: syncResult.synced,
      disabled: syncResult.disabled,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.mcpIntegration
      .update({
        where: { provider },
        data: { status: "error", statusMsg: msg },
      })
      .catch(() => {});

    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
