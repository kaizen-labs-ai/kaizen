"use client";

import { memo, useMemo } from "react";
import DOMPurify from "dompurify";
import type { UnfurlResult } from "@/lib/unfurl/types";

interface LinkPreviewEmbedProps {
  data: UnfurlResult;
}

/** Extract the height="N" value from oEmbed HTML */
function extractHeight(html: string): number | null {
  const m = html.match(/\bheight="(\d+)"/i);
  return m ? parseInt(m[1], 10) : null;
}

export const LinkPreviewEmbed = memo(function LinkPreviewEmbed({ data }: LinkPreviewEmbedProps) {
  const isVideo = data.oembedType === "video";
  const isSpotify = data.url.includes("open.spotify.com");
  const originalHeight = useMemo(
    () => (data.oembedHtml ? extractHeight(data.oembedHtml) : null),
    [data.oembedHtml],
  );

  const sanitizedHtml = useMemo(() => {
    if (!data.oembedHtml) return null;

    let html = data.oembedHtml;
    // Always strip width — CSS handles 100%
    html = html.replace(/\s+width="[^"]*"/gi, "");
    // For video, strip height so aspect-video takes over
    // For Spotify, set to 80px — Spotify's mini player breakpoint
    if (isVideo || isSpotify) {
      html = html.replace(/\s+height="[^"]*"/gi, "");
    }
    if (isSpotify) {
      html = html.replace(/<iframe/, '<iframe height="152" scrolling="no"');
    }

    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["iframe"],
      ALLOWED_ATTR: [
        "src",
        "height",
        "frameborder",
        "allow",
        "allowfullscreen",
        "title",
        "loading",
        "style",
        "scrolling",
      ],
    });
  }, [data.oembedHtml, isVideo, isSpotify]);

  if (!sanitizedHtml) return null;

  // color-scheme:normal prevents browsers from painting an opaque white canvas
  // behind iframes when the parent page uses color-scheme:dark
  const iframeStyles = isVideo
    ? "[&>iframe]:w-full [&>iframe]:aspect-video [&>iframe]:border-0 [&>iframe]:[color-scheme:normal]"
    : "[&>iframe]:w-full [&>iframe]:border-0 [&>iframe]:[color-scheme:normal]";

  // Spotify renders at fixed breakpoints: 352 / 152 / 80px — use 152px compact player
  const containerHeight = isSpotify ? 152 : (!isVideo && originalHeight ? originalHeight : undefined);
  const containerStyle = containerHeight ? { height: `${containerHeight}px` } : undefined;

  return (
    <div
      className={`overflow-hidden rounded-lg ${iframeStyles}`}
      style={containerStyle}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
});
