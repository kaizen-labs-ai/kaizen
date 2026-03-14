/**
 * shadcn UI component tools.
 *
 * Two read-only tools for the developer agent:
 * - shadcn-list:  List all available shadcn/ui components
 * - shadcn-docs:  Get documentation and source for specific components
 *
 * Uses the official `shadcn@latest mcp` server under the hood.
 */
import type { ToolExecutionResult } from "../types";
import { callShadcnTool } from "../../mcp/shadcn-client";

const MAX_OUTPUT_CHARS = 30000;

/**
 * List all available shadcn/ui components.
 */
export async function shadcnListComponentsExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  void input;
  try {
    const result = await callShadcnTool("list_items_in_registries", {
      registries: ["@shadcn"],
    });
    return { success: true, output: { result: result.slice(0, MAX_OUTPUT_CHARS) } };
  } catch (err) {
    return {
      success: false, output: null,
      error: `shadcn list failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Get usage examples and source code for a specific shadcn/ui component.
 */
export async function shadcnGetComponentDocsExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const component = input.component as string | undefined;
  if (!component) {
    return {
      success: false, output: null,
      error: "component is required — e.g. 'table', 'card', 'dialog'. Use shadcn-list first to see available components.",
    };
  }

  try {
    const result = await callShadcnTool("get_item_examples_from_registries", {
      registries: ["@shadcn"],
      query: `${component}-demo`,
    });
    return { success: true, output: { documentation: result.slice(0, MAX_OUTPUT_CHARS) } };
  } catch (err) {
    return {
      success: false, output: null,
      error: `shadcn get-component-docs failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
