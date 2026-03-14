/**
 * Skill Database tools — let agents query, modify, and inspect
 * per-skill SQLite databases.
 */

import type { ToolExecutionResult } from "../types";
import {
  skillDbExists,
  getSkillDbTables,
  querySkillDb,
  executeSkillDb,
} from "@/lib/skills/skill-db";

// ── skill-db-schema ─────────────────────────────────────────

export async function skillDbSchemaExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const skillId = input.skillId as string;
  if (!skillId) return { success: false, output: null, error: "skillId is required" };

  try {
    if (!skillDbExists(skillId)) {
      return {
        success: true,
        output: {
          hasDatabase: false,
          tables: [],
          message: "This skill has no database yet. Use skill-db-execute with a CREATE TABLE statement to create one.",
        },
      };
    }

    const tables = getSkillDbTables(skillId);
    return {
      success: true,
      output: {
        hasDatabase: true,
        tables,
        totalRows: tables.reduce((sum, t) => sum + t.rowCount, 0),
      },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
}

// ── skill-db-query ──────────────────────────────────────────

export async function skillDbQueryExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const skillId = input.skillId as string;
  const sql = input.sql as string;
  if (!skillId) return { success: false, output: null, error: "skillId is required" };
  if (!sql) return { success: false, output: null, error: "sql is required" };

  try {
    const { columns, rows } = querySkillDb(skillId, sql);
    return {
      success: true,
      output: {
        columns,
        rows,
        rowCount: rows.length,
        truncated: rows.length >= 500,
      },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
}

// ── skill-db-execute ────────────────────────────────────────

export async function skillDbExecuteExecutor(
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const skillId = input.skillId as string;
  const sql = input.sql as string;
  if (!skillId) return { success: false, output: null, error: "skillId is required" };
  if (!sql) return { success: false, output: null, error: "sql is required" };

  try {
    const { changes, lastInsertRowid } = executeSkillDb(skillId, sql);
    const normalized = sql.trim().toUpperCase();

    let message: string;
    if (normalized.startsWith("CREATE")) {
      message = "Table created successfully";
    } else if (normalized.startsWith("ALTER")) {
      message = "Table altered successfully";
    } else if (normalized.startsWith("DROP")) {
      message = "Table dropped successfully";
    } else if (normalized.startsWith("INSERT")) {
      message = `${changes} row(s) inserted`;
    } else if (normalized.startsWith("UPDATE")) {
      message = `${changes} row(s) updated`;
    } else if (normalized.startsWith("DELETE")) {
      message = `${changes} row(s) deleted`;
    } else {
      message = `Statement executed (${changes} row(s) affected)`;
    }

    return {
      success: true,
      output: { changes, lastInsertRowid: Number(lastInsertRowid), message },
    };
  } catch (err) {
    return { success: false, output: null, error: (err as Error).message };
  }
}
