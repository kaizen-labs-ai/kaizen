import type { ToolExecutionResult } from "../types";
import path from "node:path";
import { promises as fs } from "node:fs";

const MAX_BODY = 50_000;
const MAX_TEXT = 15_000;
const LARGE_JSON_THRESHOLD = 10_000; // 10KB — trigger file-based mediation

// Pre-compiled HTML extraction regexes (avoid recompilation on every web-fetch call)
const HTML_STRIP_RE = /<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi;
const HTML_CHROME_RE = /<(nav|header|footer)[\s\S]*?<\/\1>/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const HTML_BLOCK_CLOSE_RE = /<\/(p|div|li|h[1-6]|tr|blockquote|article|section)>/gi;
const HTML_BR_HR_RE = /<(br|hr)\s*\/?>/gi;
const HTML_LINK_RE = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
const HTML_INNER_TAG_RE = /<[^>]+>/g;
const HTML_ALL_TAG_RE = /<[^>]+>/g;
const HTML_ENTITY_MAP: [RegExp, string][] = [
  [/&amp;/g, "&"], [/&lt;/g, "<"], [/&gt;/g, ">"], [/&quot;/g, '"'],
  [/&#39;/g, "'"], [/&nbsp;/g, " "], [/&#x27;/g, "'"], [/&#x2F;/g, "/"],
  [/&mdash;/g, "-"], [/&ndash;/g, "-"], [/&rsquo;/g, "'"], [/&lsquo;/g, "'"],
  [/&rdquo;/g, '"'], [/&ldquo;/g, '"'], [/&hellip;/g, "..."],
];
const HTML_WHITESPACE_RE = /[^\S\n]+/g;
const HTML_MULTILINE_RE = /\n{3,}/g;

export async function webFetchExecutor(
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const url = input.url as string;
  if (!url) return { success: false, output: null, error: "url is required" };

  const method = (input.method as string) ?? "GET";
  const headers = (input.headers as Record<string, string>) ?? {};
  const body = input.body as string | undefined;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method !== "GET" ? body : undefined,
    });

    const contentType = res.headers.get("content-type") || "";
    const responseBody = await res.text();
    const isHtml = contentType.includes("text/html") || responseBody.trimStart().slice(0, 50).toLowerCase().includes("<!doctype");

    // For HTML responses, extract readable text so the LLM doesn't get 50KB of tags/scripts
    if (isHtml) {
      const text = extractTextFromHtml(responseBody);
      return {
        success: true,
        output: {
          status: res.status,
          text: text.slice(0, MAX_TEXT),
          url,
        },
      };
    }

    // Large JSON mediation: save full response to file, return summary + path
    if (responseBody.length > LARGE_JSON_THRESHOLD) {
      try {
        const parsed = JSON.parse(responseBody);
        if (Array.isArray(parsed) && parsed.length > 3) {
          const tmpDir = path.join(process.cwd(), "workspace", "tmp");
          await fs.mkdir(tmpDir, { recursive: true });
          const tmpFile = path.join(tmpDir, `web-fetch-${Date.now()}.json`);
          await fs.writeFile(tmpFile, responseBody, "utf-8");
          const safePath = tmpFile.replace(/\\/g, "/");

          const sample = parsed.slice(0, 2);
          const fields = parsed[0] && typeof parsed[0] === "object" ? Object.keys(parsed[0]) : [];
          return {
            success: true,
            output: {
              status: res.status,
              summary: `JSON array with ${parsed.length} items (${Math.round(responseBody.length / 1024)}KB).`,
              fields: fields.slice(0, 25),
              sampleItems: sample,
              fullDataPath: safePath,
              hint: `Full data saved to file. Use run-snippet to process:\nconst data = JSON.parse(require("fs").readFileSync("${safePath}", "utf-8"));\nconst filtered = data.filter(item => /* your criteria */);\nconsole.log(JSON.stringify(filtered));`,
            },
          };
        }
      } catch { /* Not valid JSON array — fall through to normal truncation */ }
    }

    return {
      success: true,
      output: {
        status: res.status,
        body: responseBody.slice(0, MAX_BODY),
      },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
}

/**
 * Lightweight HTML-to-text extraction.
 * Strips scripts, styles, nav/header/footer noise, and HTML tags.
 * Returns clean readable text with preserved structure.
 */
function extractTextFromHtml(html: string): string {
  let text = html;

  // Reset all stateful /g regexes before use
  HTML_STRIP_RE.lastIndex = 0;
  HTML_CHROME_RE.lastIndex = 0;
  HTML_COMMENT_RE.lastIndex = 0;
  HTML_BLOCK_CLOSE_RE.lastIndex = 0;
  HTML_BR_HR_RE.lastIndex = 0;
  HTML_LINK_RE.lastIndex = 0;

  // Remove script, style, noscript, svg, and their contents
  text = text.replace(HTML_STRIP_RE, " ");

  // Remove nav, header, footer elements (site chrome, not article content)
  text = text.replace(HTML_CHROME_RE, " ");

  // Remove HTML comments
  text = text.replace(HTML_COMMENT_RE, "");

  // Replace block-level elements with newlines for structure
  text = text.replace(HTML_BLOCK_CLOSE_RE, "\n");
  text = text.replace(HTML_BR_HR_RE, "\n");

  // Extract link text with URL context for navigation-heavy pages
  text = text.replace(HTML_LINK_RE, (_, href, linkText) => {
    HTML_INNER_TAG_RE.lastIndex = 0;
    const clean = linkText.replace(HTML_INNER_TAG_RE, "").trim();
    if (!clean) return "";
    if (href.startsWith("#") || href.startsWith("javascript:")) return clean;
    return clean;
  });

  // Strip all remaining HTML tags
  HTML_ALL_TAG_RE.lastIndex = 0;
  text = text.replace(HTML_ALL_TAG_RE, " ");

  // Decode common HTML entities
  for (const [re, replacement] of HTML_ENTITY_MAP) {
    re.lastIndex = 0;
    text = text.replace(re, replacement);
  }

  // Collapse whitespace: multiple spaces/tabs to single space
  HTML_WHITESPACE_RE.lastIndex = 0;
  text = text.replace(HTML_WHITESPACE_RE, " ");

  // Collapse multiple newlines (3+) to double newline
  HTML_MULTILINE_RE.lastIndex = 0;
  text = text.replace(HTML_MULTILINE_RE, "\n\n");

  // Trim each line
  text = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");

  return text;
}
