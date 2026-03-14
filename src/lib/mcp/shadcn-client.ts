/**
 * shadcn UI MCP client — singleton that manages the official shadcn MCP server subprocess.
 *
 * Provides read-only access to shadcn/ui component documentation and source code.
 * Used by the developer agent to fetch exact component styles.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client: Client | null = null;
let transport: StdioClientTransport | null = null;
let connecting: Promise<Client> | null = null;

/**
 * Get (or create) the shadcn UI MCP client singleton.
 * Lazily spawns the official `shadcn@latest mcp` subprocess on first call.
 */
export async function getShadcnClient(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      // On Windows, npx is a .cmd wrapper — must go through cmd.exe
      const isWin = process.platform === "win32";
      transport = new StdioClientTransport({
        command: isWin ? "cmd" : "npx",
        args: isWin
          ? ["/c", "npx", "shadcn@latest", "mcp"]
          : ["shadcn@latest", "mcp"],
        stderr: "ignore",
      });

      const c = new Client({ name: "kaizen", version: "1.0.0" });
      await c.connect(transport);
      client = c;
      connecting = null;
      return c;
    } catch (err) {
      connecting = null;
      throw err;
    }
  })();

  return connecting;
}

/**
 * Call a shadcn UI MCP tool and extract the text response.
 */
export async function callShadcnTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const c = await getShadcnClient();
  const result = await c.callTool({ name: toolName, arguments: args });

  // Extract text content from MCP response
  const textParts = (result.content as Array<{ type: string; text?: string }>)
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text!);

  if (result.isError) {
    throw new Error(textParts.join("\n") || "shadcn UI MCP tool returned an error");
  }

  return textParts.join("\n");
}

/**
 * Gracefully shut down the MCP server subprocess.
 * Called on process exit to prevent orphaned child processes.
 */
export async function closeShadcnClient(): Promise<void> {
  if (client) {
    try { await client.close(); } catch { /* ignore */ }
    client = null;
  }
  if (transport) {
    try { await transport.close(); } catch { /* ignore */ }
    transport = null;
  }
  connecting = null;
}
