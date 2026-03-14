import { NextResponse } from "next/server";
import { skillDbExists, getSkillDbTables, executeSkillDb } from "@/lib/skills/skill-db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!skillDbExists(id)) {
    return NextResponse.json({ hasDatabase: false, tables: [] });
  }

  try {
    const tables = getSkillDbTables(id);
    return NextResponse.json({
      hasDatabase: true,
      tables,
      totalRows: tables.reduce((sum, t) => sum + t.rowCount, 0),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

const TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!skillDbExists(id)) return NextResponse.json({ error: "No database" }, { status: 404 });

  try {
    const { table } = await req.json();
    if (!table || !TABLE_NAME_RE.test(table) || table === "_metadata") {
      return NextResponse.json({ error: "Invalid table name" }, { status: 400 });
    }
    executeSkillDb(id, `DROP TABLE IF EXISTS "${table}"`);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
