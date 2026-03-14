/**
 * Server-side oEmbed HTML sanitization.
 * Only allows <iframe> elements with src from allowlisted domains.
 * Rebuilds the iframe from scratch to prevent any XSS vectors.
 */

const ALLOWED_IFRAME_DOMAINS = [
  "youtube.com",
  "www.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "open.spotify.com",
  "player.vimeo.com",
  "w.soundcloud.com",
  "codepen.io",
  "codesandbox.io",
  "stackblitz.com",
  "bandcamp.com",
  "platform.twitter.com",
  "embed.music.apple.com",
];

const SAFE_IFRAME_ATTRS = ["src", "width", "height", "title", "allow", "allowfullscreen", "loading"];

function isDomainAllowed(src: string): boolean {
  try {
    const url = new URL(src);
    const host = url.hostname.toLowerCase();
    return ALLOWED_IFRAME_DOMAINS.some(
      (d) => host === d || host.endsWith("." + d),
    );
  } catch {
    return false;
  }
}

export function sanitizeOembedHtml(html: string): string | null {
  // Extract first iframe from the HTML
  const iframeMatch = html.match(/<iframe\s[^>]*>/i);
  if (!iframeMatch) return null;

  const tag = iframeMatch[0];

  // Extract src attribute
  const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
  if (!srcMatch || !isDomainAllowed(srcMatch[1])) return null;

  // Force dark theme for Spotify embeds
  let src = srcMatch[1];
  try {
    const srcUrl = new URL(src);
    if (srcUrl.hostname === "open.spotify.com") {
      srcUrl.searchParams.set("theme", "0");
      src = srcUrl.toString();
    }
  } catch { /* leave as-is */ }

  // Rebuild clean iframe with only safe attributes
  const attrs: string[] = [`src="${src}"`];
  for (const attr of SAFE_IFRAME_ATTRS) {
    if (attr === "src") continue; // already added with dark-theme fix
    const re = new RegExp(`\\b${attr}=["']([^"']*)["']`, "i");
    const m = tag.match(re);
    if (m) {
      attrs.push(`${attr}="${m[1]}"`);
    }
    // Handle boolean attributes (allowfullscreen without value)
    if (!m && attr === "allowfullscreen" && /\ballowfullscreen\b/i.test(tag)) {
      attrs.push("allowfullscreen");
    }
  }

  if (attrs.length === 0) return null;

  return `<iframe ${attrs.join(" ")} frameborder="0"></iframe>`;
}
