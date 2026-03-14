/**
 * Brave Search API tools — web, image, news, video, and instant data.
 *
 * Five tools:
 * - brave-search:       Web search → titles, URLs, descriptions
 * - brave-image-search: Image search → URLs, thumbnails, dimensions
 * - brave-news-search:  News search → articles with age and source
 * - brave-video-search: Video search → URLs, thumbnails, duration, views
 * - brave-instant:      Real-time data → crypto prices, stock quotes, weather, currency
 *                       (uses Brave's rich result callback — CoinGecko, OpenWeatherMap, etc.)
 *
 * API key stored in vault under "brave_api_key", set via Extensions > Brave Search.
 */
import type { ToolExecutionResult } from "../types";
import { getSecret } from "@/lib/vault/vault";

const BASE_URL = "https://api.search.brave.com/res/v1";
const VAULT_KEY = "brave_api_key";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiData = Record<string, any>;

// ── Input validation ──────────────────────────────────────────

const VALID_FRESHNESS = new Set(["pd", "pw", "pm", "py"]);
const FRESHNESS_DATE_RANGE = /^\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2}$/;

/**
 * Validate the `freshness` parameter. Returns null if valid,
 * or an error ToolExecutionResult if invalid.
 */
function validateFreshness(value: unknown): ToolExecutionResult | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (VALID_FRESHNESS.has(s) || FRESHNESS_DATE_RANGE.test(s)) return null;
  return {
    success: false,
    output: null,
    error: `Invalid freshness value: "${s}". Valid values: pd (past 24h), pw (past week), pm (past month), py (past year), or a date range like YYYY-MM-DDtoYYYY-MM-DD.`,
  };
}

// ── Shared infrastructure ─────────────────────────────────────

async function getApiKey(): Promise<string | null> {
  return getSecret(VAULT_KEY);
}

function headers(apiKey: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Accept-Encoding": "gzip",
    "X-Subscription-Token": apiKey,
  };
}

/** Fetch a Brave API endpoint. Returns parsed JSON or an error string. */
async function apiFetch(
  path: string,
  params: URLSearchParams,
  apiKey: string,
): Promise<{ ok: true; data: ApiData } | { ok: false; error: string }> {
  const res = await fetch(`${BASE_URL}/${path}?${params}`, { headers: headers(apiKey) });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Brave API key is invalid or expired. Update it in Extensions > Brave Search." };
    }
    return { ok: false, error: `Brave API error ${res.status}: ${text.slice(0, 200)}` };
  }

  return { ok: true, data: await res.json() };
}

/** Common guard: returns an error result if query or API key is missing. */
function guardInputs(
  query: string | undefined,
  apiKey: string | null,
): ToolExecutionResult | null {
  if (!query) return { success: false, output: null, error: "query is required" };
  if (!apiKey) {
    return {
      success: false,
      output: null,
      error: "Brave Search API key not configured. Add it in Extensions > Brave Search.",
    };
  }
  return null;
}

// ── Web search ────────────────────────────────────────────────

/**
 * Web search — clean web results only. No enrichments, no rich callbacks.
 * Use brave-instant for real-time data (crypto, stocks, weather).
 */
export async function braveSearchExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const query = input.query as string | undefined;
  const apiKey = await getApiKey();
  const err = guardInputs(query, apiKey);
  if (err) return err;

  const freshnessErr = validateFreshness(input.freshness);
  if (freshnessErr) return freshnessErr;

  const count = Math.min((input.count as number) ?? 10, 20);
  const freshness = input.freshness ? String(input.freshness).trim() : undefined;
  const country = input.country as string | undefined;

  const params = new URLSearchParams({
    q: query!,
    count: String(count),
    extra_snippets: "true",
  });
  if (freshness) params.set("freshness", freshness);
  if (country) params.set("country", country);

  try {
    const result = await apiFetch("web/search", params, apiKey!);
    if (!result.ok) return { success: false, output: null, error: result.error };
    const data = result.data;

    const results = (data.web?.results ?? []).map(
      (r: { title: string; url: string; description: string; extra_snippets?: string[] }) => ({
        title: r.title || "",
        url: r.url || "",
        description: r.description || "",
        ...(r.extra_snippets?.length ? { extra_snippets: r.extra_snippets } : {}),
      }),
    );

    return {
      success: true,
      output: {
        query: data.query?.original || query,
        resultCount: results.length,
        results,
      },
    };
  } catch (e) {
    return { success: false, output: null, error: `Brave search failed: ${(e as Error).message}` };
  }
}

// ── Instant data (rich results) ───────────────────────────────

/**
 * Strip timeseries arrays from rich result data — they can be 50K+ of
 * per-minute price points that the LLM doesn't need. Keep the quote/summary.
 */
function trimRichData(data: ApiData): ApiData {
  if (!data.results) return data;

  const trimmed = { ...data, results: data.results.map((r: ApiData) => {
    const copy = { ...r };

    // Cryptocurrency — keep quote, drop timeseries
    if (copy.cryptocurrency) {
      copy.cryptocurrency = { ...copy.cryptocurrency };
      delete copy.cryptocurrency.timeseries;
    }

    // Stock — keep quote, drop chart data
    if (copy.stock) {
      copy.stock = { ...copy.stock };
      delete copy.stock.timeseries;
      delete copy.stock.chart;
    }

    // Weather — keep current + forecast, drop hourly arrays
    if (copy.weather) {
      copy.weather = { ...copy.weather };
      delete copy.weather.hourly;
    }

    return copy;
  })};

  return trimmed;
}

/**
 * Instant data — returns structured real-time data for crypto prices, stock
 * quotes, weather forecasts, and currency conversions. Uses Brave's rich
 * result callback (CoinGecko, OpenWeatherMap, FMP, Fixer).
 *
 * Returns only the structured data — no web results. If no instant data is
 * available for the query, returns a short message suggesting brave-search.
 */
export async function braveInstantExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const query = input.query as string | undefined;
  const apiKey = await getApiKey();
  const err = guardInputs(query, apiKey);
  if (err) return err;

  const country = input.country as string | undefined;

  const params = new URLSearchParams({
    q: query!,
    count: "3",
    result_filter: "rich",
    enable_rich_callback: "1",
  });
  if (country) params.set("country", country);

  try {
    const result = await apiFetch("web/search", params, apiKey!);
    if (!result.ok) return { success: false, output: null, error: result.error };
    const data = result.data;

    // Check for rich result callback
    const callbackKey = data.rich?.hint?.callback_key;
    const vertical = data.rich?.hint?.vertical as string | undefined;

    if (!callbackKey) {
      return {
        success: true,
        output: {
          query: data.query?.original || query,
          available: false,
          message: "No instant data available for this query. Use brave-search for web results instead.",
        },
      };
    }

    // Fetch the rich result
    const richResult = await apiFetch(
      "web/rich",
      new URLSearchParams({ callback_key: callbackKey }),
      apiKey!,
    );

    if (!richResult.ok) {
      return {
        success: false,
        output: null,
        error: `Rich callback failed: ${richResult.error}`,
      };
    }

    return {
      success: true,
      output: {
        query: data.query?.original || query,
        available: true,
        vertical: vertical || richResult.data.type || "unknown",
        data: trimRichData(richResult.data),
      },
    };
  } catch (e) {
    return { success: false, output: null, error: `Brave instant failed: ${(e as Error).message}` };
  }
}

// ── Image search ──────────────────────────────────────────────

export async function braveImageSearchExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const query = input.query as string | undefined;
  const apiKey = await getApiKey();
  const err = guardInputs(query, apiKey);
  if (err) return err;

  const count = Math.min((input.count as number) ?? 10, 50);
  const country = input.country as string | undefined;
  const safesearch = (input.safesearch as string) === "strict" ? "strict" : "off";

  const params = new URLSearchParams({ q: query!, count: String(count), safesearch });
  if (country) params.set("country", country);

  try {
    const result = await apiFetch("images/search", params, apiKey!);
    if (!result.ok) return { success: false, output: null, error: result.error };

    const images = (result.data.results ?? []).map(
      (r: { title: string; url: string; source: string; page_url: string; properties?: { url: string; width: number; height: number }; thumbnail?: { src: string } }) => ({
        title: r.title || "",
        url: r.properties?.url || r.url || "",
        source: r.source || r.page_url || "",
        thumbnail: r.thumbnail?.src || "",
        ...(r.properties?.width ? { width: r.properties.width } : {}),
        ...(r.properties?.height ? { height: r.properties.height } : {}),
      }),
    );

    return { success: true, output: { query, imageCount: images.length, images } };
  } catch (e) {
    return { success: false, output: null, error: `Brave image search failed: ${(e as Error).message}` };
  }
}

// ── News search ───────────────────────────────────────────────

export async function braveNewsSearchExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const query = input.query as string | undefined;
  const apiKey = await getApiKey();
  const err = guardInputs(query, apiKey);
  if (err) return err;

  const freshnessErr = validateFreshness(input.freshness);
  if (freshnessErr) return freshnessErr;

  const count = Math.min((input.count as number) ?? 10, 50);
  const freshness = input.freshness ? String(input.freshness).trim() : undefined;
  const country = input.country as string | undefined;

  const params = new URLSearchParams({ q: query!, count: String(count), extra_snippets: "true" });
  if (freshness) params.set("freshness", freshness);
  if (country) params.set("country", country);

  try {
    const result = await apiFetch("news/search", params, apiKey!);
    if (!result.ok) return { success: false, output: null, error: result.error };

    const articles = (result.data.results ?? []).map(
      (r: { title: string; url: string; description: string; age?: string; meta_url?: { hostname: string }; thumbnail?: { src: string } }) => ({
        title: r.title || "",
        url: r.url || "",
        description: r.description || "",
        ...(r.age ? { age: r.age } : {}),
        ...(r.meta_url?.hostname ? { source: r.meta_url.hostname } : {}),
        ...(r.thumbnail?.src ? { thumbnail: r.thumbnail.src } : {}),
      }),
    );

    return {
      success: true,
      output: { query: result.data.query?.original || query, articleCount: articles.length, articles },
    };
  } catch (e) {
    return { success: false, output: null, error: `Brave news search failed: ${(e as Error).message}` };
  }
}

// ── Video search ──────────────────────────────────────────────

export async function braveVideoSearchExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const query = input.query as string | undefined;
  const apiKey = await getApiKey();
  const err = guardInputs(query, apiKey);
  if (err) return err;

  const freshnessErr = validateFreshness(input.freshness);
  if (freshnessErr) return freshnessErr;

  const count = Math.min((input.count as number) ?? 10, 50);
  const freshness = input.freshness ? String(input.freshness).trim() : undefined;
  const country = input.country as string | undefined;

  const params = new URLSearchParams({ q: query!, count: String(count) });
  if (freshness) params.set("freshness", freshness);
  if (country) params.set("country", country);

  try {
    const result = await apiFetch("videos/search", params, apiKey!);
    if (!result.ok) return { success: false, output: null, error: result.error };

    const videos = (result.data.results ?? []).map(
      (r: { title: string; url: string; description: string; age?: string; thumbnail?: { src: string }; video?: { duration: string; views: number; creator: string; publisher: string } }) => ({
        title: r.title || "",
        url: r.url || "",
        description: r.description || "",
        ...(r.thumbnail?.src ? { thumbnail: r.thumbnail.src } : {}),
        ...(r.video?.duration ? { duration: r.video.duration } : {}),
        ...(r.video?.views != null ? { views: r.video.views } : {}),
        ...(r.video?.creator ? { creator: r.video.creator } : {}),
        ...(r.video?.publisher ? { publisher: r.video.publisher } : {}),
        ...(r.age ? { age: r.age } : {}),
      }),
    );

    return {
      success: true,
      output: { query: result.data.query?.original || query, videoCount: videos.length, videos },
    };
  } catch (e) {
    return { success: false, output: null, error: `Brave video search failed: ${(e as Error).message}` };
  }
}
