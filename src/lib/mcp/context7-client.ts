/**
 * Context7 MCP client — singleton that manages the Context7 MCP server subprocess.
 *
 * Provides version-specific library documentation for 9,000+ packages.
 * Used by developer agent to look up correct API usage.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client: Client | null = null;
let transport: StdioClientTransport | null = null;
let connecting: Promise<Client> | null = null;

/**
 * Get (or create) the Context7 MCP client singleton.
 * Lazily spawns the MCP server subprocess on first call.
 */
export async function getContext7Client(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const npxArgs = ["-y", "@upstash/context7-mcp"];
    const apiKey = process.env.CONTEXT7_API_KEY;
    if (apiKey) {
      npxArgs.push("--api-key", apiKey);
    }

    // On Windows, npx is a .cmd wrapper — must go through cmd.exe
    const isWin = process.platform === "win32";
    transport = new StdioClientTransport({
      command: isWin ? "cmd" : "npx",
      args: isWin ? ["/c", "npx", ...npxArgs] : npxArgs,
      stderr: "ignore",
    });

    const c = new Client({ name: "kaizen", version: "1.0.0" });
    await c.connect(transport);
    client = c;
    connecting = null;
    return c;
  })();

  return connecting;
}

/**
 * Call a Context7 MCP tool and extract the text response.
 */
export async function callContext7Tool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const c = await getContext7Client();
  const result = await c.callTool({ name: toolName, arguments: args });

  // Extract text content from MCP response
  const textParts = (result.content as Array<{ type: string; text?: string }>)
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text!);

  if (result.isError) {
    throw new Error(textParts.join("\n") || "Context7 MCP tool returned an error");
  }

  return textParts.join("\n");
}

/**
 * Gracefully shut down the MCP server subprocess.
 * Called on process exit to prevent orphaned child processes.
 */
export async function closeContext7Client(): Promise<void> {
  if (client) {
    try {
      await client.close();
    } catch { /* ignore */ }
    client = null;
  }
  if (transport) {
    try {
      await transport.close();
    } catch { /* ignore */ }
    transport = null;
  }
  connecting = null;
}
