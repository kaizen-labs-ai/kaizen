"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, CalendarClock, CodeXml, Download, ExternalLink, Paperclip } from "lucide-react";
import { CodeBlock } from "@/components/ui/code-block";
import { LinkPreview } from "./link-preview";
import { ImageGallery, type GalleryImage } from "./image-gallery";
import { AudioPlayer } from "./audio-player";

// Split on URLs, \x01skill-name\x02 delimiters, \x04plugin-name\x05 delimiters, and \x03scheduled\x03 marker
const TOKEN_SPLIT_RE = /(https?:\/\/[^\s]+|\x01[^\x02]+\x02|\x04[^\x05]+\x05|\x03scheduled\x03)/g;

function renderUserText(text: string) {
  const parts = text.split(TOKEN_SPLIT_RE);
  if (parts.length === 1) return text;

  // Show icons only when the message is purely a skill/plugin invocation (no surrounding text)
  const hasSurroundingText = parts.some(
    (p) => p && !p.startsWith("http") && !p.startsWith("\x01") && !p.startsWith("\x03") && !p.startsWith("\x04") && p.trim().length > 0
  );

  const elements: React.ReactNode[] = [];
  let afterScheduled = false;
  parts.forEach((part, i) => {
    if (part.startsWith("http://") || part.startsWith("https://")) {
      let display: string;
      try {
        const url = new URL(part);
        display = url.hostname.replace(/^www\./, "");
      } catch {
        display = part;
      }
      elements.push(
        <a
          key={`url-${i}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 max-w-full text-sm text-blue-400 hover:text-blue-300 transition-colors no-underline align-baseline mx-0.5 cursor-pointer"
        >
          <span className="truncate">{display}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      );
    } else if (part === "\x03scheduled\x03") {
      afterScheduled = true;
      elements.push(
        <CalendarClock key={`sched-${i}`} className="inline-block h-3.5 w-3.5 mr-1 text-muted-foreground" style={{ verticalAlign: "middle" }} />
      );
    } else if (part.startsWith("\x01") && part.endsWith("\x02")) {
      const name = part.slice(1, -1);
      if (afterScheduled) {
        elements.push(
          <span key={`cmd-${i}`} className="font-medium text-muted-foreground">{name}</span>
        );
        afterScheduled = false;
      } else {
        if (!hasSurroundingText) {
          elements.push(
            <BookOpen key={`skill-icon-${i}`} className="inline-block h-3.5 w-3.5 mr-1" style={{ verticalAlign: "middle", color: "#ce9178" }} />
          );
        }
        elements.push(
          <span key={`cmd-${i}`} className="font-medium" style={{ color: "#ce9178" }}>{name}</span>
        );
      }
    } else if (part.startsWith("\x04") && part.endsWith("\x05")) {
      const name = part.slice(1, -1);
      if (!hasSurroundingText) {
        elements.push(
          <CodeXml key={`plugin-icon-${i}`} className="inline-block h-3.5 w-3.5 mr-1" style={{ verticalAlign: "middle", color: "#ce9178" }} />
        );
      }
      elements.push(
        <span key={`cmd-${i}`} className="font-medium" style={{ color: "#ce9178" }}>{name}</span>
      );
    } else if (part) {
      elements.push(part);
    }
  });

  return elements.length > 0 ? elements : text;
}

/** Strip base64 data URIs from assistant text — safety net for leaked Chrome snapshot data */
function stripDataUris(text: string): string {
  return text.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{20,}/g, "[base64-image-leaked]");
}

/** Extract markdown images from assistant text and return them separately */
const IMAGE_MD_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function extractAssistantImages(content: string): { text: string; images: GalleryImage[] } {
  const images: GalleryImage[] = [];
  for (const m of content.matchAll(IMAGE_MD_RE)) {
    let src = m[2];
    // Normalize artifact URLs — model sometimes omits leading slash
    if (!src.startsWith("/") && src.startsWith("api/artifacts/")) {
      src = "/" + src;
    }
    // Skip bare filenames that can't resolve (e.g. "cute_fern.jpg")
    // These happen when the model uses a filename hint instead of the artifact URL
    if (!src.startsWith("/") && !src.startsWith("http://") && !src.startsWith("https://")) {
      continue;
    }
    const isArtifact = src.includes("/api/artifacts/");
    const downloadUrl = isArtifact ? src.replace("?inline=1", "") : src;
    images.push({ src, alt: m[1] || "Image", isArtifact, downloadUrl });
  }
  const text = content.replace(IMAGE_MD_RE, "").trim();
  return { text, images };
}

// Regex patterns for upload refs embedded in user messages
const IMAGE_UPLOAD_RE = /!\[([^\]]*)\]\((\/api\/uploads\/[^)]+)\)/g;
const FILE_UPLOAD_RE = /(?<!!)\[([^\]]*)\]\((\/api\/uploads\/[^)]+)\)/g;

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv", ".gif"]);
const AUDIO_EXTENSIONS = new Set([".ogg", ".mp3", ".wav", ".aac", ".flac", ".m4a", ".opus", ".weba"]);

function isVideoFilename(name: string): boolean {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

function isAudioFilename(name: string): boolean {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

/** Parse user message content into text + upload attachments */
function parseUserAttachments(content: string): {
  text: string;
  images: { alt: string; url: string }[];
  videos: { name: string; url: string }[];
  audios: { name: string; url: string }[];
  files: { name: string; url: string }[];
} {
  const images: { alt: string; url: string }[] = [];
  const videos: { name: string; url: string }[] = [];
  const audios: { name: string; url: string }[] = [];
  const files: { name: string; url: string }[] = [];

  // Extract image uploads
  for (const m of content.matchAll(IMAGE_UPLOAD_RE)) {
    images.push({ alt: m[1], url: m[2] });
  }
  // Extract file uploads (non-image links to /api/uploads/)
  for (const m of content.matchAll(FILE_UPLOAD_RE)) {
    if (isVideoFilename(m[1])) {
      videos.push({ name: m[1], url: m[2] });
    } else if (isAudioFilename(m[1])) {
      audios.push({ name: m[1], url: m[2] });
    } else {
      files.push({ name: m[1], url: m[2] });
    }
  }

  // Strip attachment refs from text
  const text = content
    .replace(IMAGE_UPLOAD_RE, "")
    .replace(FILE_UPLOAD_RE, "")
    .trim();

  return { text, images, videos, audios, files };
}

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  linkPreviewsEnabled?: boolean;
}

// Recursively collect href values from a HAST node tree
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectHrefs(node: any): string[] {
  const hrefs: string[] = [];
  if (node.type === "element" && node.tagName === "a") {
    const href = node.properties?.href as string | undefined;
    if (href && /^https?:\/\//.test(href)) {
      hrefs.push(href);
    }
  }
  if (node.children) {
    for (const child of node.children) {
      hrefs.push(...collectHrefs(child));
    }
  }
  return hrefs;
}

export const ChatMessage = memo(function ChatMessage({ role, content, linkPreviewsEnabled = true }: ChatMessageProps) {
  const isUser = role === "user";

  if (isUser) {
    const { text, images, videos, audios, files } = parseUserAttachments(content);
    const hasAttachments = images.length > 0 || videos.length > 0 || audios.length > 0 || files.length > 0;

    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] space-y-2">
          {text && (
            <div className="rounded-lg bg-secondary text-secondary-foreground px-4 py-2 text-sm whitespace-pre-wrap break-words">
              {renderUserText(text)}
            </div>
          )}
          {hasAttachments && (
            <div className="flex flex-wrap gap-2 justify-end">
              {images.map((img) => (
                <span key={img.url} className="relative inline-block group">
                  <img
                    src={img.url}
                    alt={img.alt}
                    className="h-24 w-24 rounded-lg object-cover border border-border block"
                    loading="lazy"
                  />
                  <span className="absolute inset-0 rounded-lg bg-black/30 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2">
                    <a
                      href={img.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center h-7 w-7 rounded-md bg-white/15 text-white hover:bg-white/25 transition-colors no-underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <a
                      href={img.url}
                      download
                      className="flex items-center justify-center h-7 w-7 rounded-md bg-white/15 text-white hover:bg-white/25 transition-colors no-underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </span>
                </span>
              ))}
              {videos.map((v) => (
                <video
                  key={v.url}
                  src={v.url}
                  controls
                  className="max-h-48 max-w-full rounded-lg border border-border"
                  preload="metadata"
                />
              ))}
              {audios.map((a) => (
                <AudioPlayer key={a.url} src={a.url} />
              ))}
              {files.map((f) => (
                <a
                  key={f.url}
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-md ring-1 ring-border bg-background/50 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <Paperclip className="h-3 w-3 shrink-0" />
                  <span className="truncate max-w-[150px]">{f.name}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const sanitized = stripDataUris(content);
  const { text: textContent, images: extractedImages } = extractAssistantImages(sanitized);

  return (
    <div className="space-y-3">
      {textContent && (
        <div className="text-sm prose prose-sm prose-invert max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p({ children, node, ...props }) {
                const hrefs = node ? collectHrefs(node) : [];
                if (linkPreviewsEnabled && hrefs.length > 0) {
                  return (
                    <div className="space-y-6">
                      <p {...props}>{children}</p>
                      {hrefs.map((href) => (
                        <LinkPreview key={href} url={href} />
                      ))}
                    </div>
                  );
                }
                return <p {...props}>{children}</p>;
              },
              a({ href, children, ...props }) {
                if (href && /^https?:\/\//.test(href)) {
                  return (
                    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                      {children}
                    </a>
                  );
                }
                return <span className="text-muted-foreground">{children}</span>;
              },
              img({ src, alt }) {
                let srcStr = typeof src === "string" ? src : undefined;
                if (srcStr && !srcStr.startsWith("/") && srcStr.startsWith("api/artifacts/")) {
                  srcStr = "/" + srcStr;
                }
                // Skip bare filenames that can't resolve (model used filename instead of artifact URL)
                if (srcStr && !srcStr.startsWith("/") && !srcStr.startsWith("http://") && !srcStr.startsWith("https://")) {
                  return null;
                }
                const isArtifact = srcStr?.includes("/api/artifacts/") ?? false;
                const downloadUrl = isArtifact ? srcStr?.replace("?inline=1", "") : srcStr;
                return (
                  <span className="relative inline-block group overflow-hidden rounded-lg border border-border not-prose max-w-full">
                    <img
                      src={srcStr ?? ""}
                      alt={alt ?? "Image"}
                      className="block max-w-full max-h-96 rounded-lg"
                      loading="lazy"
                    />
                    {isArtifact && (
                      <span className="absolute inset-0 rounded-lg bg-black/40 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3">
                        <a
                          href={srcStr}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1.5 text-xs text-white hover:bg-white/25 transition-colors no-underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open
                        </a>
                        <a
                          href={downloadUrl ?? srcStr}
                          download
                          className="flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1.5 text-xs text-white hover:bg-white/25 transition-colors no-underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </a>
                      </span>
                    )}
                  </span>
                );
              },
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || "");
                const code = String(children).replace(/\n$/, "");
                if (match) {
                  return <CodeBlock language={match[1]}>{code}</CodeBlock>;
                }
                const text = String(children);
                const isNumber = /^-?\d+(\.\d+)?$/.test(text.trim());
                return (
                  <span
                    className="font-medium"
                    style={{ color: isNumber ? "#b5cea8" : "#ce9178" }}
                  >
                    {children}
                  </span>
                );
              },
              table({ children, ...props }) {
                return (
                  <div className="overflow-x-auto -mx-1">
                    <table {...props}>{children}</table>
                  </div>
                );
              },
            }}
          >
            {textContent}
          </ReactMarkdown>
        </div>
      )}

      {extractedImages.length === 1 && (
        <span className="relative inline-block group overflow-hidden rounded-lg border border-border max-w-full">
          <img
            src={extractedImages[0].src}
            alt={extractedImages[0].alt}
            className="block max-w-full max-h-96 rounded-lg"
            loading="lazy"
          />
          {extractedImages[0].isArtifact && (
            <span className="absolute inset-0 rounded-lg bg-black/40 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2 @container">
              <a
                href={extractedImages[0].src}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-md bg-white/15 px-2 py-1.5 text-xs text-white hover:bg-white/25 transition-colors no-underline"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden @[200px]:inline">Open</span>
              </a>
              <a
                href={extractedImages[0].downloadUrl ?? extractedImages[0].src}
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
      )}

      {extractedImages.length >= 2 && (
        <ImageGallery images={extractedImages} />
      )}
    </div>
  );
});
