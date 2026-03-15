/**
 * GitBook docs tool — search Kaizen's own documentation.
 *
 * Allows agents to look up how Kaizen works, its features, configuration,
 * and architecture by querying the published GitBook documentation.
 */
import type { ToolExecutionResult } from "../types";
import { searchGitBookDocs } from "../../mcp/gitbook-client";

/**
 * Search Kaizen's documentation for information about features, configuration,
 * architecture, or usage. Returns relevant documentation content.
 */
export async function gitbookDocsExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const query = input.query as string | undefined;

  if (!query) {
    return {
      success: false,
      output: null,
      error:
        "query is required — describe what you want to know about Kaizen (e.g., 'how do skills work', 'scheduling setup', 'WhatsApp integration')",
    };
  }

  try {
    const result = await searchGitBookDocs(query);

    return {
      success: true,
      output: { documentation: result },
    };
  } catch (err) {
    return {
      success: false,
      output: null,
      error: `GitBook docs lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
