/**
 * URL unfurling: fetches a page, extracts Open Graph / Twitter Card metadata,
 * discovers oEmbed endpoints, and returns structured preview data.
 */

import { getCached, setCache } from "./cache";
import { sanitizeOembedHtml } from "./sanitize";
import type { UnfurlResult } from "./types";

// ── Known oEmbed providers (no discovery needed) ─────────────

const OEMBED_PROVIDERS: Record<string, string> = {
  "youtube.com": "https://www.youtube.com/oembed",
  "www.youtube.com": "https://www.youtube.com/oembed",
  "youtu.be": "https://www.youtube.com/oembed",
  "vimeo.com": "https://vimeo.com/api/oembed.json",
  "www.vimeo.com": "https://vimeo.com/api/oembed.json",
  "open.spotify.com": "https://open.spotify.com/oembed",
  "soundcloud.com": "https://soundcloud.com/oembed",
  "www.soundcloud.com": "https://soundcloud.com/oembed",
  "twitter.com": "https://publish.twitter.com/oembed",
  "x.com": "https://publish.twitter.com/oembed",
  "www.twitter.com": "https://publish.twitter.com/oembed",
  "www.x.com": "https://publish.twitter.com/oembed",
};

// ── SSRF prevention ──────────────────────────────────────────

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^localhost$/i,
  /^\[::1\]$/,
];

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_IP_PATTERNS.some((p) => p.test(hostname));
}

// ── Meta tag parsing ─────────────────────────────────────────

interface MetaTags {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
}

function getMetaContent(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match?.[1]?.trim() || null;
}

function parseMetaTags(html: string, baseUrl: string): MetaTags {
  // Only parse <head> to avoid false matches in body content
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i);
  const head = headMatch?.[0] ?? html.slice(0, 15000);

  const title =
    getMetaContent(head, /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/) ??
    getMetaContent(head, /<meta[^>]+content="([^"]*)"[^>]+property="og:title"/) ??
    getMetaContent(head, /<meta[^>]+name="twitter:title"[^>]+content="([^"]*)"/) ??
    getMetaContent(head, /<meta[^>]+content="([^"]*)"[^>]+name="twitter:title"/) ??
    getMetaContent(head, /<title[^>]*>([^<]*)<\/title>/);

  const description =
    getMetaContent(head, /<meta[^>]+property="og:description"[^>]+content="([^"]*)"/) ??
    getMetaContent(head, /<meta[^>]+content="([^"]*)"[^>]+property="og:description"/) ??
    getMetaContent(head, /<meta[^>]+name="twitter:description"[^>]+content="([^"]*)"/) ??
    getMetaContent(head, /<meta[^>]+content="([^"]*)"[^>]+name="twitter:description"/) ??
    getMetaContent(head, /<meta[^>]+name="description"[^>]+content="([^"]*)"/) ??
    getMetaContent(head, /<meta[^>]+content="([^"]*)"[^>]+name="description"/);

  let image =
    getMetaContent(head, /<meta[^>]+property="og:image"[^>]+content="([^"]*)"/) ??
    getMetaContent(head, /<meta[^>]+content="([^"]*)"[^>]+property="og:image"/) ??
    getMetaContent(head, /<meta[^>]+name="twitter:image"[^>]+content="([^"]*)"/) ??
    getMetaContent(head, /<meta[^>]+content="([^"]*)"[^>]+name="twitter:image"/);

  // Resolve relative image URLs
  if (image && !image.startsWith("http")) {
    try {
      image = new URL(image, baseUrl).href;
    } catch { /* leave as-is */ }
  }

  const siteName =
    getMetaContent(head, /<meta[^>]+property="og:site_name"[^>]+content="([^"]*)"/) ??
    getMetaContent(head, /<meta[^>]+content="([^"]*)"[^>]+property="og:site_name"/);

  let favicon =
    getMetaContent(head, /<link[^>]+rel="(?:icon|shortcut icon)"[^>]+href="([^"]*)"/) ??
    getMetaContent(head, /<link[^>]+href="([^"]*)"[^>]+rel="(?:icon|shortcut icon)"/);

  // Resolve relative favicon URLs
  if (favicon && !favicon.startsWith("http")) {
    try {
      favicon = new URL(favicon, baseUrl).href;
    } catch { /* leave as-is */ }
  }

  return { title, description, image, siteName, favicon };
}

// ── oEmbed discovery ─────────────────────────────────────────

function discoverOembedUrl(html: string, pageUrl: string): string | null {
  // 1. Check known providers first
  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    const endpoint = OEMBED_PROVIDERS[host];
    if (endpoint) {
      return `${endpoint}?url=${encodeURIComponent(pageUrl)}&format=json`;
    }
  } catch { /* ignore */ }

  // 2. Discover via <link> tag in HTML
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i);
  const head = headMatch?.[0] ?? html.slice(0, 15000);

  const oembedLink = head.match(
    /<link[^>]+type="application\/json\+oembed"[^>]+href="([^"]*)"[^>]*>/i,
  ) ?? head.match(
    /<link[^>]+href="([^"]*)"[^>]+type="application\/json\+oembed"[^>]*>/i,
  );

  return oembedLink?.[1] ?? null;
}

async function fetchOembed(
  oembedUrl: string,
): Promise<{ html?: string; type?: string; title?: string; thumbnail_url?: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(oembedUrl, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    return (await res.json()) as {
      html?: string;
      type?: string;
      title?: string;
      thumbnail_url?: string;
    };
  } catch {
    return null;
  }
}

// ── Main unfurl function ─────────────────────────────────────

export async function unfurlUrl(url: string): Promise<UnfurlResult | null> {
  // Check cache first
  const cached = await getCached(url);
  if (cached) return cached;

  // SSRF check
  try {
    const parsed = new URL(url);
    if (isPrivateHost(parsed.hostname)) return null;
  } catch {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Kaizen-Bot/1.0 (link-preview)",
        Accept: "text/html, application/xhtml+xml",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return null;
    }

    // Only read first 100KB to avoid memory issues on huge pages
    const text = await res.text();
    const html = text.slice(0, 100_000);

    // Parse meta tags
    const meta = parseMetaTags(html, url);

    // Try oEmbed
    let oembedHtml: string | null = null;
    let oembedType: string | null = null;
    const oembedUrl = discoverOembedUrl(html, url);

    if (oembedUrl) {
      const oembedData = await fetchOembed(oembedUrl);
      if (oembedData?.html) {
        oembedHtml = sanitizeOembedHtml(oembedData.html);
        oembedType = oembedData.type ?? null;
      }
      // Use oEmbed thumbnail as fallback image
      if (!meta.image && oembedData?.thumbnail_url) {
        meta.image = oembedData.thumbnail_url;
      }
      // Use oEmbed title as fallback
      if (!meta.title && oembedData?.title) {
        meta.title = oembedData.title;
      }
    }

    const result: UnfurlResult = {
      url,
      title: meta.title,
      description: meta.description,
      imageUrl: meta.image,
      faviconUrl: meta.favicon,
      siteName: meta.siteName,
      oembedHtml,
      oembedType,
    };

    // Cache even if minimal data — prevents re-fetching empty results
    await setCache(result);
    return result;
  } catch {
    return null;
  }
}

export async function unfurlBatch(
  urls: string[],
): Promise<Record<string, UnfurlResult | null>> {
  // Deduplicate and cap
  const unique = [...new Set(urls)].slice(0, 10);

  const entries = await Promise.allSettled(
    unique.map(async (url) => [url, await unfurlUrl(url)] as const),
  );

  const results: Record<string, UnfurlResult | null> = {};
  for (const entry of entries) {
    if (entry.status === "fulfilled") {
      const [u, data] = entry.value;
      results[u] = data;
    }
  }
  return results;
}
