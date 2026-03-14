/**
 * Two-layer cache for unfurl results: in-memory Map + SQLite via Prisma.
 * Uses globalThis pattern to survive HMR re-evaluation in dev.
 */

import { prisma } from "@/lib/db/prisma";
import type { UnfurlResult } from "./types";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  data: UnfurlResult;
  fetchedAt: number;
}

const globalForCache = globalThis as unknown as {
  unfurlCache: Map<string, CacheEntry> | undefined;
};

const memoryCache =
  globalForCache.unfurlCache ?? new Map<string, CacheEntry>();

if (process.env.NODE_ENV !== "production") {
  globalForCache.unfurlCache = memoryCache;
}

export async function getCached(url: string): Promise<UnfurlResult | null> {
  // 1. Check memory cache
  const mem = memoryCache.get(url);
  if (mem && Date.now() - mem.fetchedAt < CACHE_TTL_MS) {
    return mem.data;
  }

  // 2. Check SQLite
  try {
    const row = await prisma.linkPreview.findUnique({ where: { url } });
    if (row && Date.now() - row.fetchedAt.getTime() < CACHE_TTL_MS) {
      const result: UnfurlResult = {
        url: row.url,
        title: row.title,
        description: row.description,
        imageUrl: row.imageUrl,
        faviconUrl: row.faviconUrl,
        siteName: row.siteName,
        oembedHtml: row.oembedHtml,
        oembedType: row.oembedType,
      };
      memoryCache.set(url, { data: result, fetchedAt: row.fetchedAt.getTime() });
      return result;
    }
  } catch {
    // DB error — treat as cache miss
  }

  return null;
}

export async function setCache(result: UnfurlResult): Promise<void> {
  const now = new Date();

  memoryCache.set(result.url, { data: result, fetchedAt: now.getTime() });

  try {
    await prisma.linkPreview.upsert({
      where: { url: result.url },
      update: {
        title: result.title,
        description: result.description,
        imageUrl: result.imageUrl,
        faviconUrl: result.faviconUrl,
        siteName: result.siteName,
        oembedHtml: result.oembedHtml,
        oembedType: result.oembedType,
        fetchedAt: now,
      },
      create: {
        url: result.url,
        title: result.title,
        description: result.description,
        imageUrl: result.imageUrl,
        faviconUrl: result.faviconUrl,
        siteName: result.siteName,
        oembedHtml: result.oembedHtml,
        oembedType: result.oembedType,
        fetchedAt: now,
      },
    });
  } catch {
    // DB write failure is non-critical — memory cache still works
  }
}
