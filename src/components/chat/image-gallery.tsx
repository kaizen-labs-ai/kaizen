"use client";

import { useState, useCallback } from "react";
import { Download, ExternalLink } from "lucide-react";

// ── Shared image cell with hover overlay ────────────────────

export interface GalleryImage {
  src: string;
  alt: string;
  isArtifact: boolean;
  downloadUrl?: string;
}

interface ImageCellProps extends GalleryImage {
  className?: string;
  style?: React.CSSProperties;
}

export function ImageCell({ src, alt, isArtifact, downloadUrl, className, style }: ImageCellProps) {
  return (
    <span className={`relative block group overflow-hidden rounded-lg border border-border ${className ?? ""}`} style={style}>
      <img
        src={src}
        alt={alt ?? "Image"}
        className="w-full h-full object-cover block will-change-transform"
        style={{ imageRendering: "high-quality" } as unknown as React.CSSProperties}
        loading="lazy"
      />
      {isArtifact && (
        <span className="absolute inset-0 rounded-lg bg-black/40 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2 @container">
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md bg-white/15 px-2 py-1.5 text-xs text-white hover:bg-white/25 transition-colors no-underline"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden @[200px]:inline">Open</span>
          </a>
          <a
            href={downloadUrl ?? src}
            download
            className="flex items-center gap-1.5 rounded-md bg-white/15 px-2 py-1.5 text-xs text-white hover:bg-white/25 transition-colors no-underline"
            onClick={(e) => e.stopPropagation()}
          >
            <Download className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden @[200px]:inline">Download</span>
          </a>
        </span>
      )}
    </span>
  );
}

// ── Mosaic gallery ──────────────────────────────────────────

type Orientation = "portrait" | "landscape" | "square";

interface Dims {
  w: number;
  h: number;
  ratio: number; // w/h
  orientation: Orientation;
}

function classify(w: number, h: number): Orientation {
  const ratio = w / h;
  if (ratio > 1.15) return "landscape";
  if (ratio < 0.85) return "portrait";
  return "square";
}

interface ImageGalleryProps {
  images: GalleryImage[];
}

export function ImageGallery({ images }: ImageGalleryProps) {
  const [dims, setDims] = useState<Map<string, Dims>>(new Map());
  const allLoaded = dims.size >= images.length;

  const handleLoad = useCallback(
    (src: string, e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setDims((prev) => {
        if (prev.has(src)) return prev;
        const next = new Map(prev);
        next.set(src, { w, h, ratio: w / h, orientation: classify(w, h) });
        return next;
      });
    },
    [],
  );

  // Hidden probes to detect dimensions
  const probes = images
    .filter((img) => !dims.has(img.src))
    .map((img) => (
      <img
        key={`probe-${img.src}`}
        src={img.src}
        alt=""
        className="absolute w-0 h-0 opacity-0 pointer-events-none"
        onLoad={(e) => handleLoad(img.src, e)}
      />
    ));

  if (!allLoaded) {
    return (
      <div className="relative not-prose">
        {probes}
        <div className="flex gap-1.5" style={{ height: 200 }}>
          {images.map((_, i) => (
            <div
              key={`skel-${i}`}
              className="bg-muted/30 rounded-lg animate-pulse flex-1"
            />
          ))}
        </div>
      </div>
    );
  }

  // Build the layout as an array of rows, each row is an array of image indices
  const rows = buildRows(images, dims);

  return (
    <div className="not-prose flex flex-col gap-1.5 w-full overflow-hidden">
      {rows.map((row, ri) => (
        <div key={ri} className="flex gap-1.5 w-full" style={{ height: row.height }}>
          {row.items.map((item) => (
            <ImageCell
              key={item.image.src}
              {...item.image}
              className="min-w-0"
              style={{ flex: `${item.widthPercent} 1 0%`, height: "100%" }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Layout computation ──────────────────────────────────────

const MAX_ROW_HEIGHT = 280;
const MIN_ROW_HEIGHT = 140;

interface RowItem {
  image: GalleryImage;
  widthPercent: number;
}

interface Row {
  items: RowItem[];
  height: number;
}

/**
 * Build rows using a justified layout approach:
 * Each row targets a fixed height, and images are scaled proportionally
 * so their widths sum to 100% of the container.
 */
function buildRows(images: GalleryImage[], dims: Map<string, Dims>): Row[] {
  const n = images.length;

  if (n === 2) return layout2(images, dims);
  if (n === 3) return layout3(images, dims);
  return layoutGeneric(images, dims);
}

function layout2(images: GalleryImage[], dims: Map<string, Dims>): Row[] {
  const d0 = dims.get(images[0].src)!;
  const d1 = dims.get(images[1].src)!;
  const bothLandscape = d0.orientation === "landscape" && d1.orientation === "landscape";

  if (bothLandscape) {
    // Stack vertically, each gets full width
    return [
      { items: [{ image: images[0], widthPercent: 100 }], height: MAX_ROW_HEIGHT },
      { items: [{ image: images[1], widthPercent: 100 }], height: MAX_ROW_HEIGHT },
    ];
  }

  // Side by side — width proportional to aspect ratios
  const totalRatio = d0.ratio + d1.ratio;
  const w0 = (d0.ratio / totalRatio) * 100;
  const w1 = (d1.ratio / totalRatio) * 100;

  return [
    {
      items: [
        { image: images[0], widthPercent: w0 },
        { image: images[1], widthPercent: w1 },
      ],
      height: MAX_ROW_HEIGHT,
    },
  ];
}

function layout3(images: GalleryImage[], dims: Map<string, Dims>): Row[] {
  const orientations = images.map((img) => dims.get(img.src)!.orientation);
  const portraits: number[] = [];
  const landscapes: number[] = [];

  orientations.forEach((o, i) => {
    if (o === "portrait") portraits.push(i);
    else if (o === "landscape") landscapes.push(i);
    else portraits.push(i); // treat square as portrait
  });

  // 2 portrait + 1 landscape → portraits top, landscape bottom
  if (portraits.length >= 2 && landscapes.length >= 1) {
    const p0 = portraits[0], p1 = portraits[1], l0 = landscapes[0];
    const dp0 = dims.get(images[p0].src)!;
    const dp1 = dims.get(images[p1].src)!;
    const topRatio = dp0.ratio + dp1.ratio;

    return [
      {
        items: [
          { image: images[p0], widthPercent: (dp0.ratio / topRatio) * 100 },
          { image: images[p1], widthPercent: (dp1.ratio / topRatio) * 100 },
        ],
        height: MAX_ROW_HEIGHT,
      },
      {
        items: [{ image: images[l0], widthPercent: 100 }],
        height: 260,
      },
    ];
  }

  // 2 landscape + 1 portrait → landscape top, then two below
  if (landscapes.length >= 2) {
    const l0 = landscapes[0], remaining = images.filter((_, i) => i !== l0).map((_, i) => i !== l0 ? i : -1).filter(i => i >= 0);
    // Simpler: just do top row = first, bottom row = other two
    const i1 = landscapes.length >= 2 ? landscapes[1] : portraits[0];
    const i2 = [0, 1, 2].find(i => i !== landscapes[0] && i !== i1)!;
    const d1 = dims.get(images[i1].src)!;
    const d2 = dims.get(images[i2].src)!;
    const botRatio = d1.ratio + d2.ratio;

    return [
      {
        items: [{ image: images[landscapes[0]], widthPercent: 100 }],
        height: 260,
      },
      {
        items: [
          { image: images[i1], widthPercent: (d1.ratio / botRatio) * 100 },
          { image: images[i2], widthPercent: (d2.ratio / botRatio) * 100 },
        ],
        height: MAX_ROW_HEIGHT,
      },
    ];
  }

  // All same orientation — 2 top, 1 bottom (or 1 top, 2 bottom)
  const d0 = dims.get(images[0].src)!;
  const d1 = dims.get(images[1].src)!;
  const topRatio = d0.ratio + d1.ratio;

  return [
    {
      items: [
        { image: images[0], widthPercent: (d0.ratio / topRatio) * 100 },
        { image: images[1], widthPercent: (d1.ratio / topRatio) * 100 },
      ],
      height: MAX_ROW_HEIGHT,
    },
    {
      items: [{ image: images[2], widthPercent: 100 }],
      height: 260,
    },
  ];
}

function layoutGeneric(images: GalleryImage[], dims: Map<string, Dims>): Row[] {
  // Simple greedy: pack 2-3 images per row based on orientation
  const rows: Row[] = [];
  let i = 0;

  while (i < images.length) {
    const remaining = images.length - i;

    if (remaining === 1) {
      rows.push({
        items: [{ image: images[i], widthPercent: 100 }],
        height: Math.min(MAX_ROW_HEIGHT, 220),
      });
      i++;
    } else {
      // Take 2 images per row
      const d0 = dims.get(images[i].src)!;
      const d1 = dims.get(images[i + 1].src)!;
      const totalRatio = d0.ratio + d1.ratio;

      rows.push({
        items: [
          { image: images[i], widthPercent: (d0.ratio / totalRatio) * 100 },
          { image: images[i + 1], widthPercent: (d1.ratio / totalRatio) * 100 },
        ],
        height: Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, 220)),
      });
      i += 2;
    }
  }

  return rows;
}
