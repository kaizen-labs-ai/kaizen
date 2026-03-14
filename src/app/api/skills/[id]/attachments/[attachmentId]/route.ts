import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { toAbsolutePath } from "@/lib/workspace";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id, attachmentId } = await params;

  const attachment = await prisma.skillAttachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || attachment.skillId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const absolutePath = toAbsolutePath(attachment.diskPath);
  let data: Buffer;
  try {
    data = await fs.readFile(absolutePath);
  } catch {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  const url = new URL(req.url);
  const inline = url.searchParams.get("inline") === "1";
  const disposition = inline
    ? `inline; filename="${attachment.filename}"`
    : `attachment; filename="${attachment.filename}"`;

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": disposition,
      "Content-Length": String(data.length),
    },
  });
}
