import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toAbsolutePath } from "@/lib/workspace";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const artifact = await prisma.artifact.findUnique({
    where: { id },
    include: {
      run: {
        include: {
          objective: { select: { id: true, title: true } },
        },
      },
    },
  });
  if (!artifact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(artifact);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const artifact = await prisma.artifact.findUnique({ where: { id } });
  if (!artifact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete file from disk (best-effort)
  const absPath = toAbsolutePath(artifact.diskPath);
  try { await fs.unlink(absPath); } catch {}

  // Remove parent run directory if now empty
  const dir = path.dirname(absPath);
  try {
    const remaining = await fs.readdir(dir);
    if (remaining.length === 0) await fs.rmdir(dir);
  } catch {}

  await prisma.artifact.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
