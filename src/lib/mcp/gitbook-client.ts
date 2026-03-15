/**
 * GitBook MCP client — singleton for Kaizen's own documentation.
 *
 * Connects to the GitBook-hosted MCP endpoint (public, no auth) so
 * agents can look up Kaizen's documentation to answer user questions.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const GITBOOK_MCP_ENDPOINT =
  "https://kaizen-4.gitbook.io/kaizen-docs/~gitbook/mcp";
const MAX_RESPONSE_CHARS = 30_000;

let client: Client | null = null;
let connecting: Promise<Client> | null = null;

/**
 * Get (or create) the GitBook MCP client singleton.
 * Lazily connects on first call. No auth required (public docs).
 */
export async function getGitBookClient(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const url = new URL(GITBOOK_MCP_ENDPOINT);

    // Try StreamableHTTP first, fall back to legacy SSE
    try {
      const transport = new StreamableHTTPClientTransport(url);
      const c = new Client({ name: "kaizen", version: "1.0.0" });
      await c.connect(transport);
      client = c;
      connecting = null;
      return c;
    } catch {
      const transport = new SSEClientTransport(url);
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
 * Call a GitBook MCP tool and extract the text response.
 */
export async function callGitBookTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const c = await getGitBookClient();
  const result = await c.callTool({ name: toolName, arguments: args });

  const textParts = (result.content as Array<{ type: string; text?: string }>)
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text!);

  if (result.isError) {
    throw new Error(
      textParts.join("\n") || "GitBook MCP tool returned an error",
    );
  }

  return textParts.join("\n").slice(0, MAX_RESPONSE_CHARS);
}

/**
 * Search Kaizen documentation via the GitBook MCP server.
 *
 * Discovers available tools on the server and uses the best match
 * for searching/querying documentation content.
 */
export async function searchGitBookDocs(query: string): Promise<string> {
  const c = await getGitBookClient();

  // Discover available tools on the GitBook MCP server
  const { tools } = await c.listTools();

  if (tools.length > 0) {
    // Look for a search/query tool — GitBook servers typically expose one
    const searchTool = tools.find(
      (t) =>
        t.name.includes("search") ||
        t.name.includes("query") ||
        t.name.includes("ask"),
    );

    if (searchTool) {
      return callGitBookTool(searchTool.name, { query });
    }

    // If no obvious search tool, try the first available tool with the query
    return callGitBookTool(tools[0].name, { query });
  }

  // No tools available — try reading resources directly
  const { resources } = await c.listResources();
  if (resources.length === 0) {
    throw new Error("GitBook MCP server has no tools or resources available");
  }

  // Read resources whose names match the query keywords
  const queryLower = query.toLowerCase();
  const keywords = queryLower.split(/\s+/).filter((w) => w.length > 2);

  const matches = resources
    .filter((r) => {
      const text = `${r.name ?? ""} ${r.description ?? ""}`.toLowerCase();
      return keywords.some((kw) => text.includes(kw));
    })
    .slice(0, 5); // Read at most 5 matching pages

  // If no keyword matches, read the first few resources as a fallback
  const toRead = matches.length > 0 ? matches : resources.slice(0, 3);

  const parts: string[] = [];
  for (const resource of toRead) {
    try {
      const content = await c.readResource({ uri: resource.uri });
      for (const item of content.contents) {
        if ("text" in item && item.text) {
          parts.push(`## ${resource.name ?? resource.uri}\n\n${item.text}`);
        }
      }
    } catch {
      // Skip unreadable resources
    }
  }

  if (parts.length === 0) {
    throw new Error("Could not read any documentation from GitBook");
  }

  return parts.join("\n\n---\n\n").slice(0, MAX_RESPONSE_CHARS);
}

/** Force reconnect (e.g., if endpoint changes). */
export async function resetGitBookClient(): Promise<void> {
  if (client) {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    client = null;
  }
  connecting = null;
}

/** Alias for resetGitBookClient. */
export const closeGitBookClient = resetGitBookClient;
