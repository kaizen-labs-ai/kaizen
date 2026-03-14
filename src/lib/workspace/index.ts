import path from "node:path";
import { promises as fs } from "node:fs";

const PROJECT_ROOT = process.cwd();
const WORKSPACE_DIR = path.join(PROJECT_ROOT, "workspace");
const ARTIFACTS_DIR = path.join(WORKSPACE_DIR, "artifacts");
const PLUGINS_DIR = path.join(WORKSPACE_DIR, "plugins");
const UPLOADS_DIR = path.join(WORKSPACE_DIR, "uploads");
const SKILLS_DIR = path.join(WORKSPACE_DIR, "skills");

/**
 * Get the artifacts directory for a specific run, creating it if needed.
 */
export async function getRunArtifactsDir(runId: string): Promise<string> {
  const dir = path.join(ARTIFACTS_DIR, runId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a user-provided filename to a safe path within the run's artifact directory.
 * Rejects path traversal attempts — only simple filenames allowed.
 */
export function resolveArtifactPath(runDir: string, filename: string): string {
  const sanitized = path.basename(filename);
  if (!sanitized || sanitized === "." || sanitized === "..") {
    throw new Error(`Invalid filename: "${filename}"`);
  }
  const resolved = path.join(runDir, sanitized);
  if (!resolved.startsWith(runDir)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

/**
 * Get the relative path from project root for DB storage.
 */
export function toRelativePath(absolutePath: string): string {
  return path.relative(PROJECT_ROOT, absolutePath).replace(/\\/g, "/");
}

/**
 * Resolve a stored relative path back to an absolute path.
 */
export function toAbsolutePath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath;
  return path.join(PROJECT_ROOT, relativePath);
}

/**
 * Get the upload directory for a specific upload, creating it if needed.
 */
export async function getUploadDir(uploadId: string): Promise<string> {
  const dir = path.join(UPLOADS_DIR, uploadId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Get the directory for a specific skill's attachments, creating it if needed.
 */
export async function getSkillDir(skillId: string): Promise<string> {
  const dir = path.join(SKILLS_DIR, skillId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Get the directory for a specific plugin, creating it if needed.
 */
export async function getPluginDir(name: string): Promise<string> {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "-");
  const dir = path.join(PLUGINS_DIR, sanitized);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Ensure a plugin directory has its own package.json for dependency isolation.
 * Without this, `npm install` walks up the directory tree and modifies the
 * project root package.json — polluting the main repo with plugin deps.
 */
export async function ensurePluginPackageJson(pluginDir: string): Promise<void> {
  const pkgPath = path.join(pluginDir, "package.json");
  try {
    await fs.access(pkgPath);
  } catch {
    const pluginName = path.basename(pluginDir);
    await fs.writeFile(pkgPath, JSON.stringify({
      name: `kaizen-plugin-${pluginName}`,
      version: "1.0.0",
      private: true,
    }, null, 2) + "\n", "utf-8");
  }
}

/**
 * Resolve a plugin script filename to a safe path within the plugin directory.
 */
export function resolvePluginScript(pluginDir: string, filename: string): string {
  const sanitized = path.basename(filename);
  if (!sanitized || sanitized === "." || sanitized === "..") {
    throw new Error(`Invalid filename: "${filename}"`);
  }
  const resolved = path.join(pluginDir, sanitized);
  if (!resolved.startsWith(pluginDir)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

/**
 * Guess MIME type from filename extension.
 */
export function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".json": "application/json",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".html": "text/html",
    ".xml": "application/xml",
    ".py": "text/x-python",
    ".js": "text/javascript",
    ".ts": "text/typescript",
    ".sh": "text/x-shellscript",
    ".sql": "text/x-sql",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".zip": "application/zip",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".avi": "video/x-msvideo",
    ".mov": "video/quicktime",
  };
  return mimeMap[ext] ?? "application/octet-stream";
}
