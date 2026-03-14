import { promises as fs } from "node:fs";
import path from "node:path";
import { guessMimeType } from "@/lib/workspace";

const UPLOADS_DIR = path.join(process.cwd(), "workspace", "uploads");

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const filename = url.searchParams.get("filename");

  if (!filename) {
    return new Response("filename query param required", { status: 400 });
  }

  const sanitized = path.basename(filename);
  const filePath = path.join(UPLOADS_DIR, id, sanitized);

  // Prevent path traversal
  if (!filePath.startsWith(path.join(UPLOADS_DIR, id))) {
    return new Response("Invalid path", { status: 400 });
  }

  try {
    const buffer = await fs.readFile(filePath);
    const mimeType = guessMimeType(sanitized);
    return new Response(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${sanitized}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch {
    return new Response("File not found", { status: 404 });
  }
}
