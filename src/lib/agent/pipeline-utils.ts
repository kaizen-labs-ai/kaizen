/**
 * pipeline-utils.ts
 *
 * Pure utility functions for the code pipeline: output sanitization,
 * banned API extraction, code extraction, plugin context building,
 * sample input generation, reviewer model selection, and executor output.
 *
 * Subprocess execution lives in pipeline-subprocess.ts.
 * Patch parsing/application lives in patch-engine.ts.
 */

import type { OutputModality } from "@/lib/tools/output-inspector";

// ── Pre-compiled patterns (hoisted to module level for reuse) ────

// Leaked instruction / reasoning paragraph detection — single combined regex
// avoids O(17) per-paragraph .some() loop with individual pattern tests.
const LEAKED_PATTERN_RE = new RegExp(
  [
    /^(reasoning|plan|approach|strategy|analysis):/.source,
    /^step \d/.source,
    /^(i('ll| will| need to| should) (use|call|fetch|check|look|search|query))/.source,
    /^(just explain|let me think|my approach)/.source,
    /^here('s| is) (my|the) (plan|approach|strategy)/.source,
    /^(coordinates?|current weather|latitude|longitude|api |url ):/.source,
    /^example:/.source,
    /^(output|format|response|template|instructions?):/.source,
    /^note:/.source,
    /no other text/.source,
    /no markdown/.source,
    /no code block/.source,
    /^(just |only )?(plain text|json|markdown)/.source,
    /^only (output|respond|reply|return)/.source,
    /^do not (include|add|output|mention)/.source,
    /^(remember|important|critical|warning):/.source,
    /^-{3,}$/.source,
    /^\*{3,}$/.source,
    /^={3,}$/.source,
    // Tool-call-as-text: model outputs tool calls as plain text instead of API format
    /^(bit|tool|function):\s*\S+/.source,               // "bit:brave-search { ... }"
    /^[a-z][\w]*[-_][\w-]*\s*\{/.source,                // "brave-search { ... }"
    /^\{\s*"[a-z][\w_]*"\s*:/.source,                    // orphan JSON args: { "query": ... }
  ].join("|"),
  "i",
);

// Banned API extraction — single combined regex with named alternation.
// Captures the problematic API name from various Python/JS error patterns.
const BANNED_API_RE = /(?:has no attribute|object has no attribute|got an unexpected keyword argument|cannot import name|has no member)\s+['"]([^'"]+)['"]|is not a function/g;

// Code start patterns (per-language)
const PYTHON_CODE_START_PATTERNS = [
  /^#!/, /^#\s/, /^#\s*-\*-/, /^"""/, /^'''/,
  /^import\s/, /^from\s+\S+\s+import/, /^def\s/, /^class\s/,
  /^@/, /^if\s+__name__/, /^[A-Z_][A-Z_0-9]*\s*=/,
];
const JS_CODE_START_PATTERNS = [
  /^#!/, /^\/\//, /^\/\*/, /^["']use strict/,
  /^import\s/, /^export\s/, /^const\s/, /^let\s/, /^var\s/,
  /^function\s/, /^class\s/, /^module\./, /^require\(/, /^async\s+function/,
];

// Postamble detection patterns
const POSTAMBLE_PATTERNS = [
  /^(here['']?s|this |i['']?ve |let me|note:|---)/i,
  /^(the (above|code|script|plugin)|hope this|feel free)/i,
  /^(cheers|regards|best|thanks|good luck)/i,
  /^(a (quick|brief) (rundown|summary|overview))/i,
  /^(what (changed|i did|this does))/i,
  /^(key (changes|features|points))/i,
];

// Pre-compiled separator normalization patterns
const SEP_INNER_RE = /\n-{3,}\n/g;
const SEP_START_RE = /^-{3,}\n/gm;
const SEP_END_RE = /\n-{3,}$/gm;

// Pre-compiled code fence pattern
const CODE_FENCE_RE = /```[\w]*\n([\s\S]*?)\n```/;

// ── Output sanitization ──────────────────────────────────────

export function sanitizeAgentOutput(text: string): string {
  let cleaned = text.trim();

  // ── Step 1: Normalize separators so paragraph splitting works ──
  SEP_INNER_RE.lastIndex = 0;
  SEP_START_RE.lastIndex = 0;
  SEP_END_RE.lastIndex = 0;
  cleaned = cleaned.replace(SEP_INNER_RE, "\n\n");
  cleaned = cleaned.replace(SEP_START_RE, "\n\n");
  cleaned = cleaned.replace(SEP_END_RE, "\n\n");

  // ── Step 2: Split into paragraphs ──
  const paragraphs = cleaned.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length <= 1) return paragraphs[0] ?? cleaned;

  function isLeaked(paragraph: string): boolean {
    const first = paragraph.split("\n")[0].trim();
    return LEAKED_PATTERN_RE.test(first);
  }

  // ── Step 4: Find first user-facing paragraph ──
  const userFacingIdx = paragraphs.findIndex((p) => {
    if (isLeaked(p)) return false;
    if (p.length <= 15) return false;
    return true;
  });

  if (userFacingIdx > 0) {
    cleaned = paragraphs.slice(userFacingIdx).join("\n\n").trim();
  } else if (userFacingIdx === 0) {
    cleaned = paragraphs.join("\n\n").trim();
  }
  // If userFacingIdx is -1 (everything looks leaked), return original as fallback

  return cleaned;
}

// ── Banned API extraction ────────────────────────────────────

export function extractBannedAPIs(errorMessage: string): string[] {
  const banned: string[] = [];
  BANNED_API_RE.lastIndex = 0;
  let match;
  while ((match = BANNED_API_RE.exec(errorMessage)) !== null) {
    const apiName = match[1]; // Captured API name from alternation
    if (apiName && apiName.length < 80) {
      banned.push(apiName);
    }
  }
  return banned;
}

// ── Code extraction ──────────────────────────────────────────

export function extractCode(text: string, language?: string): string {
  const trimmed = text.trim();

  // 1. Try markdown code fences first (most reliable signal)
  const fenceMatch = trimmed.match(CODE_FENCE_RE);
  if (fenceMatch) return fenceMatch[1].trim();

  // 2. Detect language-specific code start patterns
  const lang = (language ?? "python").toLowerCase();

  const codeStartPatterns = lang === "python" ? PYTHON_CODE_START_PATTERNS : JS_CODE_START_PATTERNS;

  const lines = trimmed.split("\n");

  // Find the first line that looks like code
  let codeStartIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimStart();
    if (codeStartPatterns.some((p) => p.test(line))) {
      codeStartIdx = i;
      break;
    }
  }

  // If we found a code start, strip preamble
  const codeLines = codeStartIdx > 0 ? lines.slice(codeStartIdx) : lines;

  // 3. Strip postamble — conversational text appended after code
  // Scan forward through code to find the first postamble trigger line.
  // Everything from that line onwards is conversational commentary, not code.

  // Only check the last portion of lines (postamble is always at the end)
  // For short scripts, scan from halfway; for long scripts, from 70%
  const scanStart = Math.max(1, Math.floor(codeLines.length * (codeLines.length < 20 ? 0.5 : 0.7)));
  let codeEndIdx = codeLines.length;
  for (let i = scanStart; i < codeLines.length; i++) {
    const line = codeLines[i].trim();
    if (line === "") continue;
    if (POSTAMBLE_PATTERNS.some((p) => p.test(line))) {
      codeEndIdx = i;
      break; // cut from here — everything after is postamble
    }
  }

  if (codeEndIdx < codeLines.length) {
    return codeLines.slice(0, codeEndIdx).join("\n").trim();
  }

  return codeLines.join("\n").trim();
}

// ── Plugin context and sample inputs ─────────────────────────

export function buildPluginContext(toolArgs: Record<string, unknown>): string {
  return [
    `## Plugin Details`,
    `- **Name**: ${toolArgs.name ?? "unknown"}`,
    `- **Description**: ${toolArgs.description ?? "none"}`,
    `- **Language**: ${toolArgs.language ?? "unknown"}`,
    toolArgs.inputSchema
      ? `- **Input Schema**: ${JSON.stringify(toolArgs.inputSchema)}`
      : "",
    toolArgs.dependencies
      ? `- **Dependencies**: ${(toolArgs.dependencies as string[]).join(", ")}`
      : "",
  ].filter(Boolean).join("\n");
}

/** Generate sample inputs from a JSON Schema for pipeline test execution */
export function generateSampleValue(key: string, prop: Record<string, unknown>): unknown {
  const type = (prop.type as string)?.toLowerCase() ?? "string";
  const defaultVal = prop.default;
  if (defaultVal !== undefined) return defaultVal;

  // If enum values are provided, use the first one
  const enumVals = prop.enum as unknown[] | undefined;
  if (enumVals && enumVals.length > 0) return enumVals[0];

  switch (type) {
    case "string": {
      const k = key.toLowerCase();
      const desc = ((prop.description as string) ?? "").toLowerCase();
      // Order matters — specific patterns before general ones
      // e.g. "output_filename" must match /filename/ before /name/
      if (/filename|file_name/.test(k)) {
        // Extract example value from description (e.g., 'chart.png', "report.pdf")
        const exampleMatch = desc.match(/(?:e\.g\.?|example:?|like)\s*['"`,:]?\s*['"]?([a-z0-9_-]+\.[a-z0-9]+)/i);
        if (exampleMatch) return exampleMatch[1];
        // Extract extension hint from description (.png, .pdf, etc.)
        const extMatch = desc.match(/\.(png|pdf|txt|csv|json|html|jpg|svg|xlsx|mp3|wav)\b/);
        if (extMatch) return `output${extMatch[0]}`;
        // Check for format words without dot prefix (e.g., "PDF file", "PNG image")
        const formatMatch = desc.match(/\b(png|pdf|txt|csv|json|html|jpg|svg|xlsx|mp3|wav)\b/i);
        if (formatMatch) return `output.${formatMatch[1].toLowerCase()}`;
        // Fallback: output.png (most plugins that declare filenames produce images)
        return "output.png";
      }
      if (/title|heading|subject/.test(k)) return "Sample Document Title";
      if (/content|body|text|article|description|message/.test(k))
        return "This is sample content for testing. It contains multiple paragraphs to provide a realistic amount of text for the plugin to process.\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.";
      if (/email/.test(k)) return "test@example.com";
      if (/url|link|href/.test(k)) return "https://example.com";
      if (/date/.test(k)) return new Date().toISOString().split("T")[0];
      if (/output|path/.test(k)) return "output";
      if (/color|colour|hex/.test(k)) return "#3B82F6";
      if (/format/.test(k)) return "pdf";
      if (/author|writer/.test(k)) return "Kaizen AI";
      if (/username|user_name|user/.test(k)) return "octocat";
      if (/subreddit|sub_reddit|community/.test(k)) return "technology";
      if (/channel/.test(k)) return "general";
      if (/repo|repository/.test(k)) return "facebook/react";
      if (/language|lang/.test(k)) return "python";
      if (/country/.test(k)) return "Australia";
      if (/query|search|keyword|term/.test(k)) return "artificial intelligence";
      if (/name/.test(k)) return "Sample Name";
      if (/city|location/.test(k)) return "San Francisco";
      return `Sample ${key}`;
    }
    case "number":
    case "integer": {
      const k = key.toLowerCase();
      if (/count|limit|max/.test(k)) return 5;
      if (/width|height|size/.test(k)) return 800;
      if (/font_size|fontsize/.test(k)) return 12;
      return 42;
    }
    case "boolean":
      return true;
    case "array": {
      const items = prop.items as Record<string, unknown> | undefined;
      if (items) return [generateSampleValue("item", items), generateSampleValue("item2", items)];
      return [];
    }
    case "object": {
      const nested = prop.properties as Record<string, unknown> | undefined;
      if (nested) {
        const obj: Record<string, unknown> = {};
        for (const [nk, nv] of Object.entries(nested)) {
          obj[nk] = generateSampleValue(nk, nv as Record<string, unknown>);
        }
        return obj;
      }
      // additionalProperties — generate sample map entries
      const addlProps = prop.additionalProperties as Record<string, unknown> | undefined;
      if (addlProps && typeof addlProps === "object") {
        const valType = (addlProps.type as string)?.toLowerCase();
        if (valType === "number" || valType === "integer") return { "Item A": 40, "Item B": 35, "Item C": 25 };
        if (valType === "string") return { key1: "value1", key2: "value2" };
        if (valType === "boolean") return { option1: true, option2: false };
        return { entry1: "sample", entry2: "sample" };
      }
      // Bare object with no schema — infer from key name and description
      const desc = ((prop.description as string) ?? "").toLowerCase();
      const k = key.toLowerCase();
      if (/percent|score|rating|count|stat|number|amount/.test(desc) || /data|scores|stats|metrics|values/.test(k)) {
        return { "Item A": 40, "Item B": 35, "Item C": 25 };
      }
      return { key1: "value1", key2: "value2" };
    }
    default:
      return `Sample ${key}`;
  }
}

export function generateSampleInputs(inputSchema: unknown): Record<string, unknown> {
  if (!inputSchema || typeof inputSchema !== "object") return {};
  const schema = inputSchema as Record<string, unknown>;
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (!properties) return {};

  const sample: Record<string, unknown> = {};
  for (const [key, propDef] of Object.entries(properties)) {
    if (propDef && typeof propDef === "object") {
      sample[key] = generateSampleValue(key, propDef as Record<string, unknown>);
    }
  }
  return sample;
}

/** Select reviewer model based on output modality */
export function selectReviewerModel(
  config: { model: string; imageModel?: string | null; fileModel?: string | null; audioModel?: string | null; videoModel?: string | null },
  modality: OutputModality,
): string {
  switch (modality) {
    case "image": return config.imageModel || config.model;
    case "file":  return config.fileModel || config.model;
    case "audio": return config.audioModel || config.model;
    case "video": return config.videoModel || config.model;
    default:      return config.model;
  }
}

// ── Executor output builder ──────────────────────────────────

export function buildExecutorOutput(agentRawText: string | null, savedSummaries: string[]): string {
  if (agentRawText) return sanitizeAgentOutput(agentRawText);
  if (savedSummaries.length > 0) return savedSummaries.join("\n\n");
  return "";
}
