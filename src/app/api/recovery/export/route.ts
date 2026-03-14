import { NextResponse } from "next/server";
import { exportBackup } from "@/lib/recovery/export";

export async function POST(req: Request) {
  try {
    const { password } = await req.json();
    if (!password || typeof password !== "string" || password.length < 4) {
      return NextResponse.json(
        { error: "Password must be at least 4 characters" },
        { status: 400 },
      );
    }

    const buffer = await exportBackup(password);
    const filename = `kaizen-backup-${new Date().toISOString().slice(0, 10)}.kaizen`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
