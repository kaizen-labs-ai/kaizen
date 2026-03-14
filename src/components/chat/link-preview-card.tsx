"use client";

import type { UnfurlResult } from "@/lib/unfurl/types";

interface LinkPreviewCardProps {
  data: UnfurlResult;
}

export function LinkPreviewCard({ data }: LinkPreviewCardProps) {
  const hostname = (() => {
    try {
      return new URL(data.url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className="not-prose flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2
                 no-underline transition-colors hover:bg-accent block"
    >
      {data.imageUrl && (
        <img
          src={data.imageUrl}
          alt=""
          className="h-12 w-12 rounded object-cover shrink-0"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
          {data.faviconUrl && (
            <img
              src={data.faviconUrl}
              alt=""
              className="h-3.5 w-3.5 rounded-sm"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <span className="truncate">{data.siteName || hostname}</span>
        </div>
        {data.title && (
          <div className="font-medium text-sm text-foreground line-clamp-1">
            {data.title}
          </div>
        )}
        {data.description && (
          <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
            {data.description}
          </div>
        )}
      </div>
    </a>
  );
}
