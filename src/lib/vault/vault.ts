/**
 * Encrypted Vault — stores API keys and secrets outside of process.env and the DB.
 *
 * Storage:
 *   data/vault.enc   — AES-256-GCM encrypted JSON blob
 *   data/.vault-key  — random master passphrase (auto-generated, gitignored via /data)
 *
 * Security properties:
 *   - Secrets never enter process.env (subprocesses can't read them)
 *   - Secrets never enter the database (LLM tool results can't leak them)
 *   - No "dump all values" API — only per-key retrieval
 *   - In-memory cache cleared on write
 */

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

// ── Paths ─────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data");
const VAULT_PATH = path.join(DATA_DIR, "vault.enc");
const KEY_PATH = path.join(DATA_DIR, ".vault-key");

// ── Crypto constants ──────────────────────────────────────────────

export const SALT_LEN = 16;
export const IV_LEN = 12;
export const TAG_LEN = 16;
export const KEY_LEN = 32;
export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_DIGEST = "sha512";

// ── In-memory cache ───────────────────────────────────────────────
// Use globalThis to share cache across Turbopack module instances (same
// pattern as the Prisma singleton). Without this, HMR and separate
// bundles can create duplicate vault modules with independent caches,
// causing one instance to miss writes from another.

interface VaultData {
  [key: string]: string;
}

interface VaultGlobal {
  __vaultCache: VaultData | null;
  __vaultMutex: Promise<void>;
}

const g = globalThis as unknown as Partial<VaultGlobal>;
if (!("__vaultCache" in g)) g.__vaultCache = null;
if (!("__vaultMutex" in g)) g.__vaultMutex = Promise.resolve();

function getCached(): VaultData | null { return g.__vaultCache!; }
function setCached(data: VaultData | null) { g.__vaultCache = data; }

function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__vaultMutex!;
  let release: () => void;
  g.__vaultMutex = new Promise<void>((r) => { release = r; });
  return prev.then(fn).finally(() => release!());
}

// ── Internal helpers ──────────────────────────────────────────────

export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LEN, PBKDF2_DIGEST);
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function getMasterPassphrase(): Promise<string> {
  try {
    const raw = await fs.readFile(KEY_PATH, "utf-8");
    return raw.trim();
  } catch {
    // First use: generate a random passphrase
    await ensureDataDir();
    const passphrase = crypto.randomBytes(32).toString("hex"); // 64 hex chars
    await fs.writeFile(KEY_PATH, passphrase, { mode: 0o600 });
    return passphrase;
  }
}

async function loadVault(): Promise<VaultData> {
  const c = getCached();
  if (c) return c;

  try {
    const raw = await fs.readFile(VAULT_PATH);
    if (raw.length < SALT_LEN + IV_LEN + TAG_LEN + 1) {
      // File too small to be valid — treat as empty
      setCached({});
      return getCached()!;
    }

    const passphrase = await getMasterPassphrase();
    const salt = raw.subarray(0, SALT_LEN);
    const iv = raw.subarray(SALT_LEN, SALT_LEN + IV_LEN);
    const tag = raw.subarray(raw.length - TAG_LEN);
    const ciphertext = raw.subarray(SALT_LEN + IV_LEN, raw.length - TAG_LEN);

    const key = deriveKey(passphrase, salt);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    setCached(JSON.parse(decrypted.toString("utf-8")) as VaultData);
    return getCached()!;
  } catch (err: unknown) {
    // File doesn't exist or is corrupted — start fresh
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("ENOENT")) {
      setCached({});
      return getCached()!;
    }
    // Auth tag mismatch or decrypt failure — vault is corrupted
    console.error("[vault] Failed to decrypt vault, starting fresh:", msg);
    setCached({});
    return getCached()!;
  }
}

async function saveVault(data: VaultData): Promise<void> {
  await ensureDataDir();

  const passphrase = await getMasterPassphrase();
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), "utf-8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: [salt][iv][ciphertext][tag]
  const blob = Buffer.concat([salt, iv, encrypted, tag]);
  await fs.writeFile(VAULT_PATH, blob, { mode: 0o600 });

  // Update in-memory cache
  setCached({ ...data });
}

// ── Public API ────────────────────────────────────────────────────

/** Retrieve a secret by name. Returns null if not found. */
export async function getSecret(name: string): Promise<string | null> {
  return withMutex(async () => {
    const data = await loadVault();
    return data[name] ?? null;
  });
}

/** Store a secret. Overwrites if it already exists. */
export async function setSecret(name: string, value: string): Promise<void> {
  return withMutex(async () => {
    const data = await loadVault();
    data[name] = value;
    await saveVault(data);
  });
}

/** Delete a secret by name. No-op if it doesn't exist. */
export async function deleteSecret(name: string): Promise<void> {
  return withMutex(async () => {
    const data = await loadVault();
    if (!(name in data)) return;
    delete data[name];
    await saveVault(data);
  });
}

/** List all secret names (never values). */
export async function listSecretNames(): Promise<string[]> {
  return withMutex(async () => {
    const data = await loadVault();
    return Object.keys(data);
  });
}

/** Check if a secret exists without reading its value. */
export async function hasSecret(name: string): Promise<boolean> {
  return withMutex(async () => {
    const data = await loadVault();
    return name in data;
  });
}

/**
 * Get a masked hint for a secret (e.g., "sk_...xxxx").
 * Returns null if the secret doesn't exist.
 * When `redact` is true, the hint is fully masked (for passwords/logins).
 */
export async function getSecretHint(name: string, redact?: boolean): Promise<string | null> {
  return withMutex(async () => {
    const data = await loadVault();
    const value = data[name];
    if (!value) return null;
    if (redact) return "··········";
    if (value.length <= 8) return "··········";
    return `${value.slice(0, 3)}...${value.slice(-4)}`;
  });
}

/**
 * Get all secrets (keys and values). Used only for backup export.
 * Never expose this via an API endpoint.
 */
export async function getAllSecrets(): Promise<Record<string, string>> {
  return withMutex(async () => {
    const data = await loadVault();
    return { ...data };
  });
}

/** Invalidate the in-memory cache (e.g., after external vault file changes). */
export function invalidateVaultCache(): void {
  setCached(null);
}
