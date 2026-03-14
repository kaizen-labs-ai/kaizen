"use client";

import { useState, useEffect, memo } from "react";
import { LinkPreviewCard } from "./link-preview-card";
import { LinkPreviewEmbed } from "./link-preview-embed";
import type { UnfurlResult } from "@/lib/unfurl/types";

// Module-scoped caches survive re-renders and component instances
const clientCache = new Map<string, UnfurlResult | null>();
const inflightRequests = new Map<string, Promise<UnfurlResult | null>>();

async function fetchPreview(url: string): Promise<UnfurlResult | null> {
  if (clientCache.has(url)) return clientCache.get(url)!;
  if (inflightRequests.has(url)) return inflightRequests.get(url)!;

  const promise = fetch("/api/unfurl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls: [url] }),
  })
    .then((res) => res.json())
    .then((data) => {
      const result = (data.results?.[url] as UnfurlResult) ?? null;
      clientCache.set(url, result);
      inflightRequests.delete(url);
      return result;
    })
    .catch(() => {
      clientCache.set(url, null);
      inflightRequests.delete(url);
      return null;
    });

  inflightRequests.set(url, promise);
  return promise;
}

interface LinkPreviewProps {
  url: string;
}

export const LinkPreview = memo(function LinkPreview({ url }: LinkPreviewProps) {
  const [data, setData] = useState<UnfurlResult | null | undefined>(
    clientCache.has(url) ? clientCache.get(url) : undefined,
  );

  useEffect(() => {
    if (data !== undefined) return;
    let cancelled = false;
    fetchPreview(url).then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [url, data]);

  // Loading — show a small skeleton
  if (data === undefined) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 animate-pulse">
        <div className="flex gap-3">
          <div className="h-16 w-16 rounded bg-muted shrink-0" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 w-3/4 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  // No data or error — render nothing
  if (!data || (!data.title && !data.oembedHtml)) return null;

  // oEmbed available — show embed player
  if (data.oembedHtml) {
    return <LinkPreviewEmbed data={data} />;
  }

  // Metadata card
  return <LinkPreviewCard data={data} />;
});
