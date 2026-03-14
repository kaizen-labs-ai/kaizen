/**
 * Channel-agnostic contact profile system.
 *
 * Each messaging channel (WhatsApp, Discord, Signal, etc.) can have contacts
 * with per-contact agent personalization: soul override, model, permissions,
 * and custom instructions.
 */

import { prisma } from "@/lib/db/prisma";

// ── Types ──────────────────────────────────────────────────────

export interface ContactPermissions {
  memoryAccess: boolean;
  webAccess: boolean;
  extensionAccess: boolean;
  pluginAccess: boolean;
  codeExecution: boolean;
  fileAccess: boolean;
  browserAccess: boolean;
  skillAccess: boolean;
}

export interface ContactProfile {
  id: string;
  extensionId: string;
  externalId: string;
  name: string;
  enabled: boolean;
  isSelf: boolean;
  soulId: string | null;
  model: string | null;
  customSoul: string;
  instructions: string;
  responsePrefix: string;
  permissions: ContactPermissions;
}

/** Subset of ContactProfile passed to the orchestrator. */
export interface RunContactProfile {
  contactId: string;
  soulId: string | null;
  model: string | null;
  customSoul: string;
  instructions: string;
  permissions: ContactPermissions;
}

// ── Defaults ───────────────────────────────────────────────────

export const SELF_PERMISSIONS: ContactPermissions = {
  memoryAccess: true,
  webAccess: true,
  extensionAccess: true,
  pluginAccess: true,
  codeExecution: true,
  fileAccess: true,
  browserAccess: true,
  skillAccess: true,
};

export const DEFAULT_PERMISSIONS: ContactPermissions = {
  memoryAccess: false,
  webAccess: true,
  extensionAccess: false,
  pluginAccess: false,
  codeExecution: false,
  fileAccess: false,
  browserAccess: false,
  skillAccess: false,
};

// ── Helpers ────────────────────────────────────────────────────

export function parsePermissions(raw: string, isSelf = false): ContactPermissions {
  const fallback = isSelf ? SELF_PERMISSIONS : DEFAULT_PERMISSIONS;
  try {
    const parsed = JSON.parse(raw);
    return {
      memoryAccess: parsed.memoryAccess ?? fallback.memoryAccess,
      webAccess: parsed.webAccess ?? fallback.webAccess,
      extensionAccess: parsed.extensionAccess ?? fallback.extensionAccess,
      pluginAccess: parsed.pluginAccess ?? parsed.pluginCreation ?? fallback.pluginAccess,
      codeExecution: parsed.codeExecution ?? fallback.codeExecution,
      fileAccess: parsed.fileAccess ?? fallback.fileAccess,
      browserAccess: parsed.browserAccess ?? fallback.browserAccess,
      skillAccess: parsed.skillAccess ?? fallback.skillAccess,
    };
  } catch {
    return { ...fallback };
  }
}

export function toContactProfile(row: {
  id: string;
  extensionId: string;
  externalId: string;
  name: string;
  enabled: boolean;
  isSelf: boolean;
  soulId: string | null;
  model: string | null;
  customSoul: string;
  instructions: string;
  responsePrefix: string;
  permissions: string;
}): ContactProfile {
  return {
    ...row,
    permissions: parsePermissions(row.permissions, row.isSelf),
  };
}

export function toRunContactProfile(profile: ContactProfile): RunContactProfile {
  return {
    contactId: profile.id,
    soulId: profile.soulId,
    model: profile.model,
    customSoul: profile.customSoul,
    instructions: profile.instructions,
    permissions: profile.permissions,
  };
}

// ── DB queries ─────────────────────────────────────────────────

/** Find a contact profile for a given external ID (phone number, user ID, etc.). */
export async function findContact(
  extensionId: string,
  externalId: string,
): Promise<ContactProfile | null> {
  const row = await prisma.channelContact.findUnique({
    where: { extensionId_externalId: { extensionId, externalId } },
  });
  return row ? toContactProfile(row) : null;
}

/** Find the self-contact for a given extension. */
export async function findSelfContact(
  extensionId: string,
): Promise<ContactProfile | null> {
  const row = await prisma.channelContact.findFirst({
    where: { extensionId, isSelf: true },
  });
  return row ? toContactProfile(row) : null;
}

/** Ensure the self-contact exists for a given extension. Returns the profile. */
export async function ensureSelfContact(
  extensionId: string,
  defaults?: { responsePrefix?: string },
): Promise<ContactProfile> {
  const existing = await findSelfContact(extensionId);
  if (existing) return existing;

  const row = await prisma.channelContact.create({
    data: {
      extensionId,
      externalId: "self",
      name: "Self",
      isSelf: true,
      responsePrefix: defaults?.responsePrefix ?? "Kaizen",
      permissions: JSON.stringify(SELF_PERMISSIONS),
    },
  });
  return toContactProfile(row);
}

/** Get all contacts for an extension. Self contact first. */
export async function getContacts(extensionId: string): Promise<ContactProfile[]> {
  const rows = await prisma.channelContact.findMany({
    where: { extensionId },
    orderBy: [{ isSelf: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(toContactProfile);
}

/**
 * Migrate old-style allowedNumbers array to ChannelContact rows.
 * Idempotent — skips numbers that already have a contact row.
 */
export async function migrateAllowedNumbers(
  extensionId: string,
  allowedNumbers: string[],
  defaults?: { responsePrefix?: string },
): Promise<void> {
  for (const num of allowedNumbers) {
    const existing = await prisma.channelContact.findUnique({
      where: { extensionId_externalId: { extensionId, externalId: num } },
    });
    if (!existing) {
      await prisma.channelContact.create({
        data: {
          extensionId,
          externalId: num,
          name: `+${num}`,
          isSelf: false,
          responsePrefix: defaults?.responsePrefix ?? "Kaizen",
          permissions: JSON.stringify(DEFAULT_PERMISSIONS),
        },
      });
    }
  }
}

// ── Tool filtering ─────────────────────────────────────────────

// ── Permission → tool mapping ───────────────────────────────────
// Each set lists the tools gated by that permission toggle.

const USER_MEMORY_TOOLS = new Set(["write-user-memory", "read-user-memory"]);
const CONTACT_MEMORY_TOOLS = new Set(["write-whatsapp-contact-memory"]);
const WEB_TOOLS = new Set(["web-fetch", "context7-resolve", "context7-docs"]);
const EXTENSION_TOOLS = new Set([
  "brave-search", "brave-instant", "brave-image-search", "brave-news-search", "brave-video-search",
]);
const PLUGIN_TOOLS = new Set(["create-plugin", "edit-plugin", "list-plugins", "install-plugin-deps"]);
const CODE_TOOLS = new Set(["run-snippet"]);
const FILE_TOOLS = new Set(["file-read", "file-write", "download-image"]);
const BROWSER_TOOLS = new Set([
  "chrome-navigate", "chrome-snapshot", "chrome-click", "chrome-fill",
  "chrome-evaluate", "chrome-wait", "chrome-new-tab", "chrome-list-tabs", "chrome-select-tab",
]);
const SKILL_TOOLS = new Set(["create-skill", "edit-skill", "list-skills"]);

/**
 * Filter tool definitions based on contact permissions.
 * Channel-agnostic — works for any integration.
 * Supports both flat `{ name }` and OpenRouter `{ function: { name } }` shapes.
 *
 * Memory is mutually exclusive: memoryAccess ON = user memory tools,
 * memoryAccess OFF = contact memory tools.
 */
export function filterToolsByPermissions<T>(
  tools: T[],
  permissions: ContactPermissions,
): T[] {
  return tools.filter((t) => {
    const name =
      (t as { name?: string }).name ??
      (t as { function?: { name?: string } }).function?.name ??
      "";
    // Memory is mutually exclusive: user memory when ON, contact memory when OFF
    if (!permissions.memoryAccess && USER_MEMORY_TOOLS.has(name)) return false;
    if (permissions.memoryAccess && CONTACT_MEMORY_TOOLS.has(name)) return false;
    if (!permissions.webAccess && WEB_TOOLS.has(name)) return false;
    if (!permissions.extensionAccess && (EXTENSION_TOOLS.has(name) || name.startsWith("zapier_"))) return false;
    if (!permissions.pluginAccess && PLUGIN_TOOLS.has(name)) return false;
    if (!permissions.codeExecution && CODE_TOOLS.has(name)) return false;
    if (!permissions.fileAccess && FILE_TOOLS.has(name)) return false;
    if (!permissions.browserAccess && BROWSER_TOOLS.has(name)) return false;
    if (!permissions.skillAccess && SKILL_TOOLS.has(name)) return false;
    return true;
  });
}
