/**
 * Zapier tool discovery and sync — connects to Zapier MCP server,
 * discovers available tools, and upserts them into the Tool table.
 */
import { prisma } from "@/lib/db/prisma";
import { listZapierTools, resetZapierClient } from "@/lib/mcp/zapier-client";

const ZAPIER_TOOL_PREFIX = "zapier_";
const META_TOOLS = new Set(["get_configuration_url"]);

/**
 * Sync tools from Zapier's MCP server into the local Tool table.
 * Enables new tools, disables removed ones.
 */
export async function syncZapierTools(): Promise<{
  synced: number;
  disabled: number;
  error?: string;
}> {
  try {
    const remoteTools = await listZapierTools();
    const syncedNames = new Set<string>();

    for (const rt of remoteTools) {
      const toolName = `${ZAPIER_TOOL_PREFIX}${rt.name}`;
      syncedNames.add(toolName);

      // Derive app name from annotations.title ("Google Sheets: Find Row" → "Google Sheets")
      let appName: string | undefined;
      let appSlug: string | undefined;
      if (rt.title && rt.title.includes(":")) {
        appName = rt.title.split(":")[0].trim();
        appSlug = appName.toLowerCase().replace(/\s+/g, "_");
      }

      const config = JSON.stringify({
        server: "zapier",
        remoteName: rt.name,
        ...(appName && { appName, appSlug }),
      });

      await prisma.tool.upsert({
        where: { name: toolName },
        update: {
          description: rt.description,
          inputSchema: JSON.stringify(rt.inputSchema),
          enabled: true,
          config,
        },
        create: {
          name: toolName,
          description: rt.description,
          type: "mcp",
          config,
          inputSchema: JSON.stringify(rt.inputSchema),
          outputSchema: "{}",
          enabled: true,
          createdBy: "zapier",
        },
      });
    }

    // Disable tools that disappeared from Zapier
    const existing = await prisma.tool.findMany({ where: { createdBy: "zapier" } });
    let disabledCount = 0;
    for (const t of existing) {
      if (!syncedNames.has(t.name) && t.enabled) {
        await prisma.tool.update({ where: { id: t.id }, data: { enabled: false } });
        disabledCount++;
      }
    }

    // Update integration status
    await prisma.mcpIntegration.update({
      where: { provider: "zapier" },
      data: {
        status: "connected",
        statusMsg: (() => {
          const userTools = [...syncedNames].filter((n) => !META_TOOLS.has(n.replace(ZAPIER_TOOL_PREFIX, "")));
          return `${userTools.length} tool${userTools.length !== 1 ? "s" : ""}`;
        })(),
        config: JSON.stringify({
          mcpEndpoint: "https://mcp.zapier.com/api/v1/connect",
          lastSyncAt: new Date().toISOString(),
          toolCount: syncedNames.size,
        }),
      },
    });

    return { synced: syncedNames.size, disabled: disabledCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    await prisma.mcpIntegration
      .update({
        where: { provider: "zapier" },
        data: { status: "error", statusMsg: msg },
      })
      .catch(() => {});

    await resetZapierClient();
    return { synced: 0, disabled: 0, error: msg };
  }
}

/** Remove all Zapier-created tools from the DB. */
export async function removeAllZapierTools(): Promise<void> {
  await prisma.tool.deleteMany({ where: { createdBy: "zapier" } });
}

/** Get the tool prefix used for Zapier tools. */
export const ZAPIER_PREFIX = ZAPIER_TOOL_PREFIX;
