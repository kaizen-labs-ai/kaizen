import { NextResponse } from "next/server";
import { skillDbExists, getSkillDbTables, querySkillDb, executeSkillDb } from "@/lib/skills/skill-db";

const TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function validateTable(table: string): string | null {
  if (!TABLE_NAME_RE.test(table)) return "Invalid table name";
  if (table === "_metadata") return "Cannot access _metadata table";
  return null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; table: string }> },
) {
  const { id, table } = await params;
  const err = validateTable(table);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  if (!skillDbExists(id)) return NextResponse.json({ error: "No database" }, { status: 404 });

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));
  const search = url.searchParams.get("search") ?? "";
  const sort = url.searchParams.get("sort") ?? "rowid";
  const dir = url.searchParams.get("dir")?.toUpperCase() === "DESC" ? "DESC" : "ASC";

  try {
    // Get column names from schema inspector (safe — no SQL injection risk)
    const tables = getSkillDbTables(id);
    const tableInfo = tables.find((t) => t.name === table);
    if (!tableInfo) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    const colNames = tableInfo.columns.map((c) => c.name);
    const allCols = ["rowid", ...colNames];
    const safeSort = allCols.includes(sort) ? sort : "rowid";

    // Build WHERE clause for search
    let where = "";
    if (search.trim()) {
      const escaped = search.replace(/'/g, "''");
      const conditions = colNames
        .map((c) => `CAST("${c}" AS TEXT) LIKE '%' || '${escaped}' || '%'`);
      if (conditions.length > 0) where = `WHERE ${conditions.join(" OR ")}`;
    }

    // Count
    const countResult = querySkillDb(id, `SELECT COUNT(*) as cnt FROM "${table}" ${where}`);
    const total = (countResult.rows[0] as unknown[])[0] as number;

    // Find INTEGER PRIMARY KEY column — SQLite aliases it as rowid,
    // so `SELECT rowid, *` won't return a separate "rowid" column.
    const pkCol = tableInfo.columns.find((c) => c.pk)?.name;

    // Fetch page — returns { columns: string[], rows: unknown[][] }
    const offset = (page - 1) * limit;
    const result = querySkillDb(
      id,
      `SELECT rowid, * FROM "${table}" ${where} ORDER BY "${safeSort}" ${dir} LIMIT ${limit} OFFSET ${offset}`,
    );

    // Convert array rows to objects for the frontend
    const hasRowidCol = result.columns.includes("rowid");
    const rows = result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      result.columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      // Ensure "rowid" always exists — fall back to the INTEGER PRIMARY KEY column
      if (!hasRowidCol && pkCol && obj[pkCol] != null) {
        obj.rowid = obj[pkCol];
      }
      return obj;
    });

    return NextResponse.json({ columns: result.columns, rows, total, page, limit });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; table: string }> },
) {
  const { id, table } = await params;
  const err = validateTable(table);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  if (!skillDbExists(id)) return NextResponse.json({ error: "No database" }, { status: 404 });

  try {
    const body = await req.json();
    const entries = Object.entries(body).filter(([k]) => k !== "rowid");
    if (entries.length === 0) return NextResponse.json({ error: "No columns provided" }, { status: 400 });

    const cols = entries.map(([k]) => `"${k}"`).join(", ");
    const placeholders = entries.map(([, v]) => {
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "number") return String(v);
      return `'${String(v).replace(/'/g, "''")}'`;
    }).join(", ");

    const result = executeSkillDb(id, `INSERT INTO "${table}" (${cols}) VALUES (${placeholders})`);
    return NextResponse.json({ success: true, lastInsertRowid: Number(result.lastInsertRowid) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; table: string }> },
) {
  const { id, table } = await params;
  const err = validateTable(table);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  if (!skillDbExists(id)) return NextResponse.json({ error: "No database" }, { status: 404 });

  try {
    const body = await req.json();
    const rowids: number[] = body.rowids;
    if (!Array.isArray(rowids) || rowids.length === 0) {
      return NextResponse.json({ error: "rowids array required" }, { status: 400 });
    }

    const idList = rowids.map((r) => Number(r)).join(", ");
    const result = executeSkillDb(id, `DELETE FROM "${table}" WHERE rowid IN (${idList})`);
    return NextResponse.json({ success: true, deleted: result.changes });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
