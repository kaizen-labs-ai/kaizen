import { prisma } from "@/lib/db/prisma";
import { toAbsolutePath } from "@/lib/workspace";
import { promises as fs } from "node:fs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const artifact = await prisma.artifact.findUnique({ where: { id } });
  if (!artifact) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(req.url);
  const inline = url.searchParams.get("inline") === "1";
  const disposition = inline
    ? `inline; filename="${artifact.filename}"`
    : `attachment; filename="${artifact.filename}"`;

  try {
    const absolutePath = toAbsolutePath(artifact.diskPath);
    const fileBuffer = await fs.readFile(absolutePath);

    return new Response(fileBuffer, {
      headers: {
        "Content-Type": artifact.mimeType,
        "Content-Disposition": disposition,
        "Content-Length": String(artifact.sizeBytes),
      },
    });
  } catch {
    return new Response("File not found on disk", { status: 404 });
  }
}
