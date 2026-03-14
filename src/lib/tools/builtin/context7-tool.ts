/**
 * Context7 tools — version-specific library documentation lookup.
 *
 * Two tools exposed to agents:
 * - context7-resolve: Resolve a library name to a Context7 library ID
 * - context7-docs:    Fetch documentation for a resolved library
 */
import type { ToolExecutionResult } from "../types";
import { callContext7Tool } from "../../mcp/context7-client";

/**
 * Resolve a human-readable library name to a Context7-compatible library ID.
 * Returns a ranked list of matching libraries with IDs, snippet counts, and trust scores.
 */
export async function context7ResolveExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const libraryName = input.libraryName as string | undefined;
  const query = input.query as string | undefined;

  if (!libraryName) {
    return { success: false, output: null, error: "libraryName is required" };
  }

  try {
    const result = await callContext7Tool("resolve-library-id", {
      libraryName,
      query: query ?? libraryName,
    });

    return {
      success: true,
      output: { result: result.slice(0, 10000) },
    };
  } catch (err) {
    return {
      success: false,
      output: null,
      error: `Context7 resolve failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Fetch version-specific documentation and code examples for a library.
 * Requires a Context7 library ID (from context7-resolve) or a known ID like "/vercel/next.js".
 */
export async function context7DocsExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const libraryId = input.libraryId as string | undefined;
  const query = input.query as string | undefined;

  if (!libraryId) {
    return { success: false, output: null, error: "libraryId is required (e.g. '/vercel/next.js'). Use context7-resolve first to find the ID." };
  }
  if (!query) {
    return { success: false, output: null, error: "query is required — describe what you need from the docs" };
  }

  try {
    const args: Record<string, unknown> = { libraryId, query };
    if (input.topic) args.topic = input.topic;
    if (input.tokens) args.tokens = input.tokens;

    const result = await callContext7Tool("query-docs", args);

    return {
      success: true,
      output: { documentation: result.slice(0, 30000) },
    };
  } catch (err) {
    return {
      success: false,
      output: null,
      error: `Context7 docs failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
