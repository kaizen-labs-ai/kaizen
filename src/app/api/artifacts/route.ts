import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { promises as fs } from "node:fs";
import path from "node:path";
import { toAbsolutePath } from "@/lib/workspace";
import { getAllArtifacts } from "@/lib/artifacts/queries";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("runId");
  const objectiveId = searchParams.get("objectiveId");
  const category = searchParams.get("category");

  // Use shared query for unfiltered requests (the common case from the list page)
  if (!runId && !objectiveId && !category) {
    const artifacts = await getAllArtifacts();
    return NextResponse.json(artifacts);
  }

  const where: Record<string, unknown> = {};
  if (runId) where.runId = runId;
  if (category) where.category = category;
  if (objectiveId) {
    where.run = { objectiveId };
  }

  const artifacts = await prisma.artifact.findMany({
    where,
    include: {
      run: {
        include: {
          objective: {
            select: { id: true, title: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(artifacts);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const intermediateOnly = searchParams.get("intermediate") === "true";

  if (!intermediateOnly) {
    return NextResponse.json(
      { error: "Only intermediate cleanup is supported" },
      { status: 400 }
    );
  }

  const where = { intermediate: true };

  // Get artifacts to delete files from disk
  const artifacts = await prisma.artifact.findMany({ where });

  // Delete files from disk and track parent directories (best-effort)
  const dirs = new Set<string>();
  for (const artifact of artifacts) {
    const absPath = toAbsolutePath(artifact.diskPath);
    dirs.add(path.dirname(absPath));
    try { await fs.unlink(absPath); } catch {}
  }

  // Remove parent run directories if now empty
  for (const dir of dirs) {
    try {
      const remaining = await fs.readdir(dir);
      if (remaining.length === 0) await fs.rmdir(dir);
    } catch {}
  }

  // Delete DB records
  const result = await prisma.artifact.deleteMany({ where });
  return NextResponse.json({ deleted: result.count });
}
