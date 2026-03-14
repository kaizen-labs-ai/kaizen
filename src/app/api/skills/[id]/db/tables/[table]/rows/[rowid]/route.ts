import { NextResponse } from "next/server";
import { skillDbExists, executeSkillDb } from "@/lib/skills/skill-db";

const TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; table: string; rowid: string }> },
) {
  const { id, table, rowid } = await params;

  if (!TABLE_NAME_RE.test(table) || table === "_metadata") {
    return NextResponse.json({ error: "Invalid table name" }, { status: 400 });
  }
  if (!skillDbExists(id)) return NextResponse.json({ error: "No database" }, { status: 404 });

  try {
    const body = await req.json();
    const entries = Object.entries(body).filter(([k]) => k !== "rowid");
    if (entries.length === 0) return NextResponse.json({ error: "No columns to update" }, { status: 400 });

    const sets = entries.map(([k, v]) => {
      if (v === null || v === undefined) return `"${k}" = NULL`;
      if (typeof v === "number") return `"${k}" = ${v}`;
      return `"${k}" = '${String(v).replace(/'/g, "''")}'`;
    }).join(", ");

    const result = executeSkillDb(id, `UPDATE "${table}" SET ${sets} WHERE rowid = ${Number(rowid)}`);
    return NextResponse.json({ success: true, changes: result.changes });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
