/**
 * Chrome DevTools MCP client — singleton that manages the chrome-devtools-mcp server subprocess.
 *
 * Provides browser automation: navigate pages, click elements, fill forms, read content.
 * Used by executor agent for web interaction.
 *
 * Auto-launches Chrome with --remote-debugging-port=9222 if not already running.
 * Uses a separate user-data-dir so it doesn't conflict with the user's normal Chrome session.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import * as os from "os";
import { getSetting } from "@/lib/settings/registry";

let client: Client | null = null;
let transport: StdioClientTransport | null = null;
let connecting: Promise<Client> | null = null;
let chromeProcess: ChildProcess | null = null;

const DEBUG_PORT = parseInt(process.env.CHROME_DEVTOOLS_PORT ?? "9222", 10);
const BROWSER_URL = process.env.CHROME_DEVTOOLS_URL ?? `http://127.0.0.1:${DEBUG_PORT}`;

// Dedicated profile directory so Chrome launches as a separate instance
// (won't merge into an existing Chrome session)
const CHROME_PROFILE_DIR = path.join(os.tmpdir(), "kaizen-chrome-debug");

/** Common Chrome paths on Windows */
const CHROME_PATHS_WIN = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].filter(Boolean) as string[];

/**
 * Check if Chrome's debug port is already reachable.
 */
function isDebugPortOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${BROWSER_URL}/json/version`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Find the Chrome executable on disk.
 * Returns the path or null if not found.
 */
function findChrome(): string | null {
  for (const p of CHROME_PATHS_WIN) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch { /* not found, try next */ }
  }
  return null;
}

/**
 * Launch Chrome with remote debugging enabled.
 * Uses a separate user-data-dir to avoid merging into existing Chrome sessions.
 * Waits until the debug port is reachable before returning.
 */
async function launchChrome(): Promise<void> {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error(
      "Chrome not found. Please install Google Chrome or set the CHROME_PATH environment variable to point to your Chrome executable."
    );
  }

  // Ensure the profile directory exists
  fs.mkdirSync(CHROME_PROFILE_DIR, { recursive: true });

  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${CHROME_PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];

  // Check if incognito mode is enabled in settings
  const incognito = await getSetting("browser_incognito", "false");
  if (incognito === "true") {
    args.push("--incognito");
  }

  chromeProcess = spawn(chromePath, args, {
    stdio: "ignore",
    detached: true,
  });

  // Don't let the Chrome process keep Node alive
  chromeProcess.unref();

  // Wait for the debug port to become reachable (up to 15 seconds)
  const maxWait = 15_000;
  const interval = 500;
  let waited = 0;
  while (waited < maxWait) {
    if (await isDebugPortOpen()) return;
    await new Promise((r) => setTimeout(r, interval));
    waited += interval;
  }

  throw new Error(
    `Chrome was launched but the debug port (${DEBUG_PORT}) did not become reachable within 15 seconds. ` +
    `Try closing all Chrome windows and retrying.`
  );
}

/**
 * Get (or create) the Chrome DevTools MCP client singleton.
 * Auto-launches Chrome if the debug port isn't already open.
 */
export async function getChromeDevToolsClient(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      // Ensure Chrome is running with debug port
      if (!(await isDebugPortOpen())) {
        await launchChrome();
      }

      const args = ["-y", "chrome-devtools-mcp@latest", `--browserUrl=${BROWSER_URL}`];

      transport = new StdioClientTransport({
        command: "npx",
        args,
        stderr: "ignore",
      });

      const c = new Client({ name: "kaizen", version: "1.0.0" });
      await c.connect(transport);
      client = c;
      connecting = null;
      return c;
    } catch (err) {
      // Clear connecting so future calls can retry
      connecting = null;
      throw err;
    }
  })();

  return connecting;
}

/**
 * Call a Chrome DevTools MCP tool and extract the text response.
 * If the call fails due to a connection issue (Chrome was closed), automatically
 * resets the client, relaunches Chrome, and retries once.
 */
export async function callChromeDevTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const c = await getChromeDevToolsClient();
      const result = await c.callTool({ name: toolName, arguments: args });

      // Extract text content from MCP response
      const textParts = (result.content as Array<{ type: string; text?: string }>)
        .filter((part) => part.type === "text" && part.text)
        .map((part) => part.text!);

      if (result.isError) {
        const errMsg = textParts.join("\n") || "";
        // Connection-related errors from the MCP server → reset and retry
        if (attempt === 0 && isConnectionError(errMsg)) {
          await resetClient();
          continue;
        }
        throw new Error(errMsg || "Chrome DevTools MCP tool returned an error");
      }

      return textParts.join("\n");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Connection/transport errors → reset and retry on first attempt
      if (attempt === 0 && isConnectionError(msg)) {
        await resetClient();
        continue;
      }
      throw err;
    }
  }

  throw new Error("Chrome DevTools: failed after retry");
}

/** Check if an error message indicates a lost Chrome/MCP connection */
function isConnectionError(msg: string): boolean {
  return /connect|fetch failed|ECONNREFUSED|websocket|not running|closed|transport/i.test(msg);
}

/**
 * Reset the client and transport so the next call re-establishes everything.
 */
async function resetClient(): Promise<void> {
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

/**
 * Gracefully shut down the MCP server subprocess.
 * Called on process exit to prevent orphaned child processes.
 */
export async function closeChromeDevToolsClient(): Promise<void> {
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
