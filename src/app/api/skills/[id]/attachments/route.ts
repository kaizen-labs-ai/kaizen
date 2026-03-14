import { NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { getSkillDir, toRelativePath, guessMimeType } from "@/lib/workspace";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large (max 20MB)" }, { status: 413 });
  }

  const skillDir = await getSkillDir(id);
  const sanitized = path.basename(file.name) || "upload";
  const filePath = path.join(skillDir, sanitized);
  const mimeType = file.type || guessMimeType(sanitized);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  // If a file with the same name already exists for this skill, replace the old record
  const existing = await prisma.skillAttachment.findFirst({
    where: { skillId: id, filename: sanitized },
  });
  if (existing) {
    await prisma.skillAttachment.delete({ where: { id: existing.id } });
  }

  const attachment = await prisma.skillAttachment.create({
    data: {
      skillId: id,
      filename: sanitized,
      diskPath: toRelativePath(filePath),
      mimeType,
      sizeBytes: file.size,
    },
  });

  return NextResponse.json(attachment, { status: 201 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const attachmentId = url.searchParams.get("attachmentId");

  if (!attachmentId) {
    return NextResponse.json({ error: "attachmentId is required" }, { status: 400 });
  }

  const attachment = await prisma.skillAttachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || attachment.skillId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete file from disk (best-effort)
  try {
    const skillDir = await getSkillDir(id);
    const filePath = path.join(skillDir, path.basename(attachment.filename));
    await fs.unlink(filePath);
  } catch { /* file may already be gone */ }

  await prisma.skillAttachment.delete({ where: { id: attachmentId } });
  return NextResponse.json({ success: true });
}
