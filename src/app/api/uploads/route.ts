import { NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { getUploadDir, guessMimeType } from "@/lib/workspace";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large (max 20MB)" }, { status: 413 });
  }

  const uploadId = crypto.randomUUID();
  const uploadDir = await getUploadDir(uploadId);
  const sanitized = path.basename(file.name) || "upload";
  const filePath = path.join(uploadDir, sanitized);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  const mimeType = file.type || guessMimeType(sanitized);

  return NextResponse.json({
    uploadId,
    filename: sanitized,
    mimeType,
    sizeBytes: file.size,
  });
}
