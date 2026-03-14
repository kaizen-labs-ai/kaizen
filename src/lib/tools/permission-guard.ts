/**
 * Server-side tool permission guard.
 *
 * Last line of defense: even if a tool was accidentally offered to the LLM
 * (prompt-level filtering bug) or the LLM hallucinated a tool call, this
 * guard rejects execution when the contact's permissions forbid it.
 */

import { prisma } from "@/lib/db/prisma";
import { parsePermissions } from "@/lib/extensions/contacts";

// ── Permission -> tool name mapping (mirrors filterToolsByPermissions) ──

const MEMORY_GATED = new Set(["read-user-memory", "write-user-memory"]);
const CONTACT_MEMORY_GATED = new Set(["write-whatsapp-contact-memory"]);
const WEB_GATED = new Set(["web-fetch", "context7-resolve", "context7-docs"]);
const EXTENSION_GATED = new Set([
  "brave-search", "brave-instant", "brave-image-search", "brave-news-search", "brave-video-search",
]);
const PLUGIN_GATED = new Set(["create-plugin", "edit-plugin", "list-plugins", "install-plugin-deps"]);
const CODE_GATED = new Set(["run-snippet"]);
const FILE_GATED = new Set(["file-read", "file-write", "download-image"]);
const BROWSER_GATED = new Set([
  "chrome-navigate", "chrome-snapshot", "chrome-click", "chrome-fill",
  "chrome-evaluate", "chrome-wait", "chrome-new-tab", "chrome-list-tabs", "chrome-select-tab",
]);
const SKILL_GATED = new Set(["create-skill", "edit-skill", "list-skills"]);

// In-memory permission cache — permissions don't change during a run, so
// caching avoids a DB query on every tool call for contact-initiated runs.
const permissionCache = new Map<string, ReturnType<typeof parsePermissions>>();

/** Clear the cached permissions for a contact (e.g., after settings change). */
export function invalidatePermissionCache(contactId?: string) {
  if (contactId) permissionCache.delete(contactId);
  else permissionCache.clear();
}

/**
 * Check if a tool call is allowed for a given contact.
 * Returns null if allowed, or a denial message string if blocked.
 */
export async function checkToolPermission(
  toolName: string,
  contactId: string,
): Promise<string | null> {
  // Load contact permissions — cached per contactId to avoid DB query per tool call
  let permissions = permissionCache.get(contactId);
  if (!permissions) {
    try {
      const contact = await prisma.channelContact.findUnique({
        where: { id: contactId },
        select: { permissions: true, isSelf: true },
      });
      if (!contact) return null; // Contact not found — allow (defensive)
      permissions = parsePermissions(contact.permissions, contact.isSelf);
      permissionCache.set(contactId, permissions);
    } catch {
      return null; // DB error — allow (defensive, don't break runs)
    }
  }

  // Memory is mutually exclusive: user memory when ON, contact memory when OFF
  if (!permissions.memoryAccess && MEMORY_GATED.has(toolName)) {
    return `Permission denied: "${toolName}" requires memory access, which is disabled for this contact.`;
  }
  if (permissions.memoryAccess && CONTACT_MEMORY_GATED.has(toolName)) {
    return `Permission denied: "${toolName}" is only available when personal memory access is off.`;
  }
  if (!permissions.webAccess && WEB_GATED.has(toolName)) {
    return `Permission denied: "${toolName}" requires web access, which is disabled for this contact.`;
  }
  if (!permissions.extensionAccess && (EXTENSION_GATED.has(toolName) || toolName.startsWith("zapier_"))) {
    return `Permission denied: "${toolName}" requires extension access, which is disabled for this contact.`;
  }
  if (!permissions.pluginAccess && PLUGIN_GATED.has(toolName)) {
    return `Permission denied: "${toolName}" requires plugin access, which is disabled for this contact.`;
  }
  if (!permissions.codeExecution && CODE_GATED.has(toolName)) {
    return `Permission denied: "${toolName}" requires code execution, which is disabled for this contact.`;
  }
  if (!permissions.fileAccess && FILE_GATED.has(toolName)) {
    return `Permission denied: "${toolName}" requires file access, which is disabled for this contact.`;
  }
  if (!permissions.browserAccess && BROWSER_GATED.has(toolName)) {
    return `Permission denied: "${toolName}" requires browser access, which is disabled for this contact.`;
  }
  if (!permissions.skillAccess && SKILL_GATED.has(toolName)) {
    return `Permission denied: "${toolName}" requires skill access, which is disabled for this contact.`;
  }

  // Also check plugin-type tools (custom plugins) when pluginAccess is off
  if (!permissions.pluginAccess) {
    try {
      const tool = await prisma.tool.findUnique({
        where: { name: toolName },
        select: { type: true },
      });
      if (tool?.type === "plugin") {
        return `Permission denied: "${toolName}" is a plugin, and plugin access is disabled for this contact.`;
      }
    } catch {
      // DB error — allow (defensive)
    }
  }

  return null; // Allowed
}
