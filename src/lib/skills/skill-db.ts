/**
 * Skill Database — per-skill SQLite databases for persistent structured data.
 * Each skill gets an optional `skill.db` file at workspace/skills/{skillId}/skill.db,
 * created lazily on first write. The agent owns the schema (CREATE TABLE, ALTER TABLE);
 * the system owns the `_metadata` table.
 */

import Database from "better-sqlite3";
import path from "node:path";
import { existsSync } from "node:fs";

const WORKSPACE_DIR = path.join(process.cwd(), "workspace", "skills");

// ── Path helpers ────────────────────────────────────────────

export function getSkillDbPath(skillId: string): string {
  return path.join(WORKSPACE_DIR, skillId, "skill.db");
}

export function skillDbExists(skillId: string): boolean {
  return existsSync(getSkillDbPath(skillId));
}

// ── Open / create ───────────────────────────────────────────

/**
 * Open (or create) a skill's database. Sets WAL mode and creates _metadata
 * table on first use. Caller MUST close the returned Database instance.
 */
export function openSkillDb(skillId: string): Database.Database {
  const dbPath = getSkillDbPath(skillId);
  const dir = path.dirname(dbPath);
  // Ensure skill directory exists
  const fs = require("node:fs");
  fs.mkdirSync(dir, { recursive: true });

  const isNew = !existsSync(dbPath);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  if (isNew) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _metadata (key TEXT PRIMARY KEY, value TEXT);
      INSERT OR IGNORE INTO _metadata VALUES ('created_at', '${new Date().toISOString()}');
      INSERT OR IGNORE INTO _metadata VALUES ('schema_version', '1');
    `);
  }

  return db;
}

// ── Local-time normalization ─────────────────────────────────
// SQLite's datetime('now'), CURRENT_TIMESTAMP, CURRENT_DATE, and
// CURRENT_TIME all return UTC. Users expect local time in skill
// databases, so we transparently rewrite them to local-time equivalents.

function localizeTimestamps(sql: string): string {
  return sql
    .replace(/datetime\(\s*'now'\s*\)/gi, "datetime('now', 'localtime')")
    // Wrap in parens so DEFAULT CURRENT_TIMESTAMP → DEFAULT (datetime(...)) is valid SQLite
    .replace(/\bCURRENT_TIMESTAMP\b/gi, "(datetime('now', 'localtime'))")
    .replace(/\bCURRENT_DATE\b/gi, "(date('now', 'localtime'))")
    .replace(/\bCURRENT_TIME\b/gi, "(time('now', 'localtime'))");
}

/**
 * Auto-add DEFAULT CURRENT_TIMESTAMP to TIMESTAMP/DATETIME columns in CREATE TABLE
 * that don't already have a DEFAULT. The system guarantees every timestamp column
 * has a real value — agents don't need to remember to add defaults.
 */
function ensureTimestampDefaults(sql: string): string {
  if (!/^\s*CREATE\s+TABLE/i.test(sql)) return sql;
  // Match "column_name TIMESTAMP" or "column_name DATETIME" not followed by DEFAULT
  // before the next comma or closing paren.
  return sql.replace(
    /(\b\w+\s+(?:TIMESTAMP|DATETIME)\b)(?![^,)]*\bDEFAULT\b)/gi,
    "$1 DEFAULT CURRENT_TIMESTAMP",
  );
}

// ── SQL validation ──────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /\bATTACH\s+DATABASE\b/i,
  /\bLOAD_EXTENSION\b/i,
  /\.load\b/i,
  /\b_metadata\b/i,
];

const BLOCKED_PRAGMA_WRITE = /\bPRAGMA\b(?!.*\b(table_info|table_list|database_list|compile_options)\b)/i;

export function validateSql(sql: string, readOnly: boolean): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(sql)) {
      return `Blocked: SQL contains a restricted operation (${pattern.source})`;
    }
  }
  if (BLOCKED_PRAGMA_WRITE.test(sql)) {
    return "Blocked: PRAGMA writes are not allowed in skill databases";
  }
  if (readOnly) {
    const normalized = sql.trim().toUpperCase();
    if (!normalized.startsWith("SELECT") && !normalized.startsWith("WITH")) {
      return "Only SELECT queries are allowed in read-only mode";
    }
  }
  return null; // valid
}

// ── Schema inspection ───────────────────────────────────────

export interface ColumnInfo {
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
}

export function getSkillDbTables(skillId: string): TableInfo[] {
  if (!skillDbExists(skillId)) return [];

  const db = new Database(getSkillDbPath(skillId), { readonly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('_metadata', 'sqlite_sequence') ORDER BY name")
      .all() as { name: string }[];

    return tables.map((t) => {
      const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all() as {
        name: string; type: string; notnull: number; pk: number;
      }[];
      const countRow = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as { c: number };
      return {
        name: t.name,
        columns: cols.map((c) => ({
          name: c.name,
          type: c.type || "TEXT",
          notnull: c.notnull === 1,
          pk: c.pk > 0,
        })),
        rowCount: countRow.c,
      };
    });
  } finally {
    db.close();
  }
}

// ── Query (read-only) ───────────────────────────────────────

const MAX_QUERY_ROWS = 500;

export function querySkillDb(
  skillId: string,
  sql: string,
): { columns: string[]; rows: unknown[][] } {
  const error = validateSql(sql, true);
  if (error) throw new Error(error);

  if (!skillDbExists(skillId)) {
    throw new Error("This skill has no database yet. Use skill-db-execute to create tables first.");
  }

  const db = new Database(getSkillDbPath(skillId), { readonly: true });
  try {
    const stmt = db.prepare(localizeTimestamps(sql));
    const results = stmt.all() as Record<string, unknown>[];
    const columns = results.length > 0 ? Object.keys(results[0]) : stmt.columns().map((c) => c.name);
    const rows = results.slice(0, MAX_QUERY_ROWS).map((r) => columns.map((c) => r[c]));
    return { columns, rows };
  } finally {
    db.close();
  }
}

// ── Execute (DDL/DML) ───────────────────────────────────────

export function executeSkillDb(
  skillId: string,
  sql: string,
): { changes: number; lastInsertRowid: number | bigint } {
  const error = validateSql(sql, false);
  if (error) throw new Error(error);

  const db = openSkillDb(skillId); // creates if needed
  try {
    const result = db.exec(localizeTimestamps(ensureTimestampDefaults(sql)));
    // For statements that modify data, get changes from the DB
    const changes = db.prepare("SELECT changes() as c").get() as { c: number };
    const lastId = db.prepare("SELECT last_insert_rowid() as id").get() as { id: number | bigint };
    return { changes: changes.c, lastInsertRowid: lastId.id };
  } finally {
    db.close();
  }
}
