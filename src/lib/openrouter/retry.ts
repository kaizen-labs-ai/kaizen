/**
 * Shared retry wrapper for non-streaming OpenRouter calls.
 * Handles 429 rate-limit errors and transient network errors
 * (fetch failed, ECONNRESET, etc.) with exponential backoff.
 */

import { callOpenRouter, type NonStreamResponse } from "./client";

type NonStreamCallOptions = Parameters<typeof callOpenRouter>[0] & { stream?: false };

/** Patterns that indicate a transient network error worth retrying (pre-lowercased). */
const TRANSIENT_ERROR_PATTERNS = [
  "fetch failed",
  "econnreset",
  "econnrefused",
  "etimedout",
  "enetunreach",
  "socket hang up",
  "network error",
  "502",
  "503",
  "504",
];

function isTransientError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((p) => lower.includes(p));
}

export async function callOpenRouterWithRetry(
  params: NonStreamCallOptions,
  opts?: { retries?: number; delay?: number; signal?: AbortSignal; timeout?: number },
): Promise<NonStreamResponse> {
  const { retries = 2, delay = 3000, signal, timeout } = opts ?? {};
  const merged = { timeout: timeout ?? 120_000, ...params, ...(signal ? { signal } : {}) };
  try {
    return await callOpenRouter(merged);
  } catch (err) {
    if (signal?.aborted) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    const shouldRetry = msg.includes("429") || isTransientError(msg);
    if (shouldRetry && retries > 0) {
      await new Promise((r) => setTimeout(r, delay));
      return callOpenRouterWithRetry(params, { retries: retries - 1, delay: delay * 2, signal, timeout });
    }
    throw err;
  }
}
