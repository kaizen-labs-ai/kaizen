/**
 * Chrome DevTools browser automation tools.
 *
 * Six tools exposed to agents:
 * - chrome-navigate: Navigate to a URL (or back/forward/reload)
 * - chrome-snapshot: Read the page as an accessibility tree (text)
 * - chrome-click:    Click an element by its uid from the snapshot
 * - chrome-fill:     Fill a form field with text
 * - chrome-evaluate: Run JavaScript on the page
 * - chrome-wait:     Wait for specific text to appear on the page
 * - chrome-new-tab:  Open a new tab with a URL
 * - chrome-list-tabs: List all open tabs
 * - chrome-select-tab: Switch to a specific tab
 */
import type { ToolExecutionResult } from "../types";
import { callChromeDevTool } from "../../mcp/chrome-devtools-client";

const MAX_OUTPUT_CHARS = 30000;

// Pre-compiled regex for stripping base64 data URIs (called on every Chrome tool result)
const DATA_URI_RE = /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{20,}/g;

/** Strip base64 data URIs from Chrome output — snapshots can contain huge
 *  inline thumbnails that waste tokens and confuse the model. */
function stripDataUris(text: string): string {
  DATA_URI_RE.lastIndex = 0;
  return text.replace(DATA_URI_RE, "[base64-image]");
}

/**
 * Navigate to a URL or go back/forward/reload.
 */
export async function chromeNavigateExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const url = input.url as string | undefined;
  const type = (input.type as string | undefined) ?? "url";

  if (type === "url" && !url) {
    return { success: false, output: null, error: "url is required when type is 'url'" };
  }

  try {
    const args: Record<string, unknown> = { type };
    if (url) args.url = url;
    const result = await callChromeDevTool("navigate_page", args);
    return { success: true, output: { result: result.slice(0, MAX_OUTPUT_CHARS) } };
  } catch (err) {
    return {
      success: false, output: null,
      error: `Chrome navigate failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Take a snapshot of the page as an accessibility tree.
 * Returns structured text content — much more useful than raw HTML.
 */
export async function chromeSnapshotExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const verbose = input.verbose === true;

  try {
    const result = await callChromeDevTool("take_snapshot", { verbose });
    return { success: true, output: { snapshot: stripDataUris(result).slice(0, MAX_OUTPUT_CHARS) } };
  } catch (err) {
    return {
      success: false, output: null,
      error: `Chrome snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Click an element identified by its uid from a snapshot.
 */
export async function chromeClickExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const uid = input.uid as string | undefined;
  if (!uid) {
    return { success: false, output: null, error: "uid is required — use chrome-snapshot first to find element uids" };
  }

  try {
    const args: Record<string, unknown> = { uid };
    if (input.includeSnapshot === true) args.includeSnapshot = true;
    const result = await callChromeDevTool("click", args);
    return { success: true, output: { result: stripDataUris(result).slice(0, MAX_OUTPUT_CHARS) } };
  } catch (err) {
    return {
      success: false, output: null,
      error: `Chrome click failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Fill a form field (input, textarea, select) with a value.
 */
export async function chromeFillExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const uid = input.uid as string | undefined;
  const value = input.value as string | undefined;

  if (!uid) {
    return { success: false, output: null, error: "uid is required — use chrome-snapshot first to find element uids" };
  }
  if (value === undefined) {
    return { success: false, output: null, error: "value is required" };
  }

  try {
    const args: Record<string, unknown> = { uid, value };
    if (input.includeSnapshot === true) args.includeSnapshot = true;
    const result = await callChromeDevTool("fill", args);
    return { success: true, output: { result: stripDataUris(result).slice(0, MAX_OUTPUT_CHARS) } };
  } catch (err) {
    return {
      success: false, output: null,
      error: `Chrome fill failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute JavaScript on the current page and return the result.
 */
export async function chromeEvaluateExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  let fn = (input.function ?? input.code) as string | undefined;
  if (!fn) {
    return { success: false, output: null, error: "function is required — provide a JavaScript function string to execute" };
  }

  // Auto-wrap arrow functions → named function expressions.
  // The Chrome MCP tool expects a function() declaration, not an arrow function.
  const trimmed = fn.trim();
  if (trimmed.startsWith("(") && !trimmed.startsWith("(function")) {
    fn = "function() " + trimmed.replace(/^\([^)]*\)\s*=>\s*/, "");
  }

  try {
    const args: Record<string, unknown> = { function: fn };
    if (input.args) args.args = input.args;
    const result = await callChromeDevTool("evaluate_script", args);
    return { success: true, output: { result: stripDataUris(result).slice(0, MAX_OUTPUT_CHARS) } };
  } catch (err) {
    return {
      success: false, output: null,
      error: `Chrome evaluate failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Wait for specific text to appear on the page.
 */
export async function chromeWaitExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const raw = input.text;
  if (!raw) {
    return { success: false, output: null, error: "text is required" };
  }
  // MCP server expects text as string[] — auto-wrap if agent passes a string
  const textArray = Array.isArray(raw) ? raw : [raw];

  try {
    const args: Record<string, unknown> = { text: textArray };
    if (input.timeout !== undefined) args.timeout = input.timeout;
    const result = await callChromeDevTool("wait_for", args);
    return { success: true, output: { result: result.slice(0, MAX_OUTPUT_CHARS) } };
  } catch (err) {
    return {
      success: false, output: null,
      error: `Chrome wait failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Open a new tab and navigate to a URL.
 */
export async function chromeNewTabExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const url = input.url as string | undefined;
  if (!url) {
    return { success: false, output: null, error: "url is required" };
  }

  try {
    const args: Record<string, unknown> = { url };
    if (input.background === true) args.background = true;
    const result = await callChromeDevTool("new_page", args);
    return { success: true, output: { result: result.slice(0, MAX_OUTPUT_CHARS) } };
  } catch (err) {
    return {
      success: false, output: null,
      error: `Chrome new tab failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * List all open tabs with their page IDs and URLs.
 */
export async function chromeListTabsExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  void input;
  try {
    const result = await callChromeDevTool("list_pages", {});
    return { success: true, output: { result: result.slice(0, MAX_OUTPUT_CHARS) } };
  } catch (err) {
    return {
      success: false, output: null,
      error: `Chrome list tabs failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Get the current page URL from the active browser tab.
 * Used by use-secret to verify domain authorization before filling secrets.
 */
export async function getCurrentPageUrl(): Promise<string | null> {
  try {
    const result = await callChromeDevTool("evaluate_script", {
      function: "function() { return window.location.href; }",
    });
    if (typeof result !== "string") return null;
    // The MCP response may wrap the URL in a markdown response — extract it
    const match = result.match(/https?:\/\/[^\s"')]+/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

/**
 * Switch to a specific tab by its page ID.
 */
export async function chromeSelectTabExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const pageId = input.pageId as string | undefined;
  if (!pageId) {
    return { success: false, output: null, error: "pageId is required — use chrome-list-tabs first to find page IDs" };
  }

  try {
    const result = await callChromeDevTool("select_page", { pageId });
    return { success: true, output: { result: result.slice(0, MAX_OUTPUT_CHARS) } };
  } catch (err) {
    return {
      success: false, output: null,
      error: `Chrome select tab failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
