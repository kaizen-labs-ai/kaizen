/**
 * Zapier MCP client — singleton for Zapier's remote MCP server.
 *
 * Uses HTTP+SSE transport (not stdio) since Zapier is a hosted server.
 * API key is read from the encrypted vault — never from env vars or DB.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { getSecret } from "@/lib/vault/vault";

const ZAPIER_MCP_ENDPOINT = "https://mcp.zapier.com/api/v1/connect";
const MAX_RESPONSE_CHARS = 30_000;

let client: Client | null = null;
let connecting: Promise<Client> | null = null;

/**
 * Get (or create) the Zapier MCP client singleton.
 * Lazily connects on first call. API key sourced from vault.
 */
export async function getZapierClient(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const apiKey = await getSecret("zapier_api_key");
    if (!apiKey) {
      connecting = null;
      throw new Error("Zapier MCP token not configured. Add it in Extensions > Zapier.");
    }

    const url = new URL(ZAPIER_MCP_ENDPOINT);
    const headers = { Authorization: `Bearer ${apiKey}` };

    // Try StreamableHTTP first, fall back to legacy SSE
    try {
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers },
      });
      const c = new Client({ name: "kaizen", version: "1.0.0" });
      await c.connect(transport);
      client = c;
      connecting = null;
      return c;
    } catch {
      // Fall back to SSE transport
      const transport = new SSEClientTransport(url, {
        requestInit: { headers },
      });
      const c = new Client({ name: "kaizen", version: "1.0.0" });
      await c.connect(transport);
      client = c;
      connecting = null;
      return c;
    }
  })();

  return connecting;
}

/**
 * Call a Zapier MCP tool and extract the text response.
 */
export async function callZapierTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const c = await getZapierClient();
  const result = await c.callTool({ name: toolName, arguments: args });

  const textParts = (result.content as Array<{ type: string; text?: string }>)
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text!);

  if (result.isError) {
    throw new Error(textParts.join("\n") || "Zapier MCP tool returned an error");
  }

  return textParts.join("\n").slice(0, MAX_RESPONSE_CHARS);
}

/**
 * Discover all tools available on the connected Zapier MCP server.
 */
export async function listZapierTools(): Promise<
  Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    title?: string;
  }>
> {
  const c = await getZapierClient();
  const result = await c.listTools();
  return result.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
    title: (t.annotations as { title?: string } | undefined)?.title,
  }));
}

/** Force reconnect (e.g., after API key change). */
export async function resetZapierClient(): Promise<void> {
  if (client) {
    try { await client.close(); } catch { /* ignore */ }
    client = null;
  }
  connecting = null;
}

/** Alias for resetZapierClient. */
export const closeZapierClient = resetZapierClient;
