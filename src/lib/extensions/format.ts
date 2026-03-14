/**
 * Convert markdown to messaging-app-friendly plain text.
 *
 * Reusable across WhatsApp, Telegram, Discord, etc.
 * Each platform can apply additional formatting on top of the base output.
 *
 * Returns cleaned text + set of artifact IDs referenced in the text
 * (so the caller knows which artifacts were inline and can send them as native media).
 */
export function formatForMessaging(text: string): {
  text: string;
  referencedArtifactIds: Set<string>;
} {
  let result = text;
  const referencedArtifactIds = new Set<string>();

  // ── 1. Strip markdown image refs ──
  // ![alt](/api/artifacts/{id}/download?inline=1) → removed (sent as native media)
  // ![alt](filename.ext) → removed (matched to artifact by caller)
  // ![alt](https://...) → removed (external image, can't embed in text)
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, _alt: string, src: string) => {
    const idMatch = src.match(/\/api\/artifacts\/([^/]+)\//);
    if (idMatch) referencedArtifactIds.add(idMatch[1]);
    return "";
  });

  // ── 2. Convert artifact links to stripped (sent as attachment) ──
  // [Download report](/api/artifacts/{id}/download) → removed
  result = result.replace(
    /\[([^\]]*)\]\(\/api\/artifacts\/([^/]+)\/download[^)]*\)/g,
    (_match, _label: string, id: string) => {
      referencedArtifactIds.add(id);
      return "";
    },
  );

  // ── 3. Convert markdown links to plain text + URL ──
  // [Title](https://example.com) → Title
  // https://example.com
  result = result.replace(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (_match, label: string, url: string) => {
    if (label === url || !label.trim()) return url;
    return `${label}\n${url}`;
  });

  // ── 4. Markdown formatting → WhatsApp-compatible ──

  // Headers: # text → *text*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Bold: **text** or __text__ → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");
  result = result.replace(/__(.+?)__/g, "*$1*");

  // Strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, "~$1~");

  // Bullet lists: - item or * item → • item (but not inside code blocks)
  result = result.replace(/^[-*]\s+/gm, "• ");

  // Horizontal rules: --- or *** → strip
  result = result.replace(/^[-*]{3,}$/gm, "");

  // ── 5. Clean up whitespace ──
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  return { text: result, referencedArtifactIds };
}
