import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toAbsolutePath } from "@/lib/workspace";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const objective = await prisma.objective.findUnique({
    where: { id },
    include: {
      skill: true,
      runs: { include: { steps: { orderBy: { sequence: "asc" } } }, orderBy: { sequence: "desc" } },
    },
  });

  if (!objective) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(objective);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { title, description, status, skillId, config } = body;

  const data: Record<string, unknown> = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (status !== undefined) data.status = status;
  if (skillId !== undefined) data.skillId = skillId;
  if (config !== undefined) data.config = JSON.stringify(config);

  const objective = await prisma.objective.update({ where: { id }, data });
  return NextResponse.json(objective);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Collect artifact files and run IDs before cascade-deleting DB records
  const runs = await prisma.run.findMany({
    where: { objectiveId: id },
    select: { id: true, artifacts: { select: { diskPath: true } } },
  });

  await prisma.objective.delete({ where: { id } });

  // Clean up artifact files, run directories, and snippet directories from disk (best-effort)
  const artifactsBase = toAbsolutePath("workspace/artifacts");
  const snippetsBase = toAbsolutePath("workspace/_snippets");
  for (const run of runs) {
    for (const artifact of run.artifacts) {
      try { await fs.unlink(toAbsolutePath(artifact.diskPath)); } catch {}
    }
    try { await fs.rm(path.join(artifactsBase, run.id), { recursive: true, force: true }); } catch {}
    try { await fs.rm(path.join(snippetsBase, run.id), { recursive: true, force: true }); } catch {}
  }

  return NextResponse.json({ success: true });
}
