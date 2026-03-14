/**
 * patch-engine.ts
 *
 * SEARCH/REPLACE block parsing and application for developer patch mode.
 * Extracted from pipeline-utils.ts for cohesion.
 */

// ── Types ──────────────────────────────────────────────────────

export interface PatchResult {
  script: string;
  appliedCount: number;
  failedCount: number;
  failures: string[];
}

// ── Parsing ────────────────────────────────────────────────────

// Pre-compiled marker patterns for the state machine (avoid per-line recompilation)
const SEARCH_START_RE = /^<{7}\s*SEARCH\s*$/;
const SEPARATOR_RE = /^={7,}\s*$/;
const REPLACE_END_RE = /^>{7}\s*REPLACE\s*$/;

/**
 * Parse SEARCH/REPLACE blocks using a line-by-line state machine.
 * More robust than a single regex — handles empty replacements, \r\n, and
 * tolerates minor formatting variations from the model.
 */
export function parseSearchReplaceBlocks(response: string): { search: string; replace: string }[] {
  const lines = response.split(/\r?\n/);
  const blocks: { search: string; replace: string }[] = [];

  let state: "outside" | "search" | "replace" = "outside";
  let searchLines: string[] = [];
  let replaceLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimEnd();

    if (state === "outside" && SEARCH_START_RE.test(trimmed)) {
      state = "search";
      searchLines = [];
      replaceLines = [];
    } else if (state === "search" && SEPARATOR_RE.test(trimmed)) {
      state = "replace";
    } else if (state === "replace" && REPLACE_END_RE.test(trimmed)) {
      blocks.push({
        search: searchLines.join("\n"),
        replace: replaceLines.join("\n"),
      });
      state = "outside";
    } else if (state === "search") {
      searchLines.push(line);
    } else if (state === "replace") {
      replaceLines.push(line);
    }
    // Lines in "outside" state are ignored (model explanations, etc.)
  }

  return blocks;
}

// ── Fuzzy matching ─────────────────────────────────────────────

/**
 * Fuzzy-match a search block against the script by comparing lines with
 * trailing whitespace stripped. Preserves the script's original indentation
 * in the non-matched portions.
 */
export function fuzzyReplace(script: string, search: string, replace: string): string | null {
  const searchLines = search.split("\n");
  const scriptLines = script.split("\n");

  if (searchLines.length === 0) return null;

  for (let i = 0; i <= scriptLines.length - searchLines.length; i++) {
    let match = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (scriptLines[i + j].trimEnd() !== searchLines[j].trimEnd()) {
        match = false;
        break;
      }
    }
    if (match) {
      const before = scriptLines.slice(0, i);
      const after = scriptLines.slice(i + searchLines.length);
      const newLines = replace.split("\n");
      return [...before, ...newLines, ...after].join("\n");
    }
  }

  return null;
}

// ── Application ────────────────────────────────────────────────

// Pre-compiled validation patterns for post-patch marker leak detection
const LEAKED_MARKER_RE = /^(<{7}\s*SEARCH|>{7}\s*REPLACE)\s*$/m;
const SEPARATOR_COUNT_RE = /^={7,}\s*$/gm;

/**
 * Parse and apply <<<<<<< SEARCH / ======= / >>>>>>> REPLACE blocks to a script.
 * Returns null if no valid blocks are found OR if the patched script contains
 * leaked conflict markers (caller should fall back to full rewrite).
 */
export function applySearchReplaceBlocks(script: string, response: string): PatchResult | null {
  const blocks = parseSearchReplaceBlocks(response);

  if (blocks.length === 0) return null;

  let result = script;
  let appliedCount = 0;
  let failedCount = 0;
  const failures: string[] = [];

  for (const block of blocks) {
    if (result.includes(block.search)) {
      // Replace only the first occurrence (like Claude Code's Edit tool)
      result = result.replace(block.search, block.replace);
      appliedCount++;
    } else {
      // Fuzzy fallback: match with trailing-whitespace tolerance
      const fuzzyResult = fuzzyReplace(result, block.search, block.replace);
      if (fuzzyResult !== null) {
        result = fuzzyResult;
        appliedCount++;
      } else {
        failedCount++;
        failures.push(block.search.slice(0, 80));
      }
    }
  }

  // ── Post-patch validation: detect leaked conflict markers ──
  // If the patched script contains SEARCH/REPLACE markers that weren't in the
  // original, the patches corrupted the code — reject and fall back to full rewrite.
  if (!LEAKED_MARKER_RE.test(script) && LEAKED_MARKER_RE.test(result)) {
    return null; // marker leakage detected
  }
  // Check for standalone ======= lines introduced by patches
  const countSeparators = (s: string) => {
    SEPARATOR_COUNT_RE.lastIndex = 0;
    return (s.match(SEPARATOR_COUNT_RE) || []).length;
  };
  if (countSeparators(result) > countSeparators(script)) {
    return null; // separator marker leaked into the code
  }

  return { script: result, appliedCount, failedCount, failures };
}
