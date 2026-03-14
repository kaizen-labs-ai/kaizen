import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toAbsolutePath } from "@/lib/workspace";
import { exec } from "node:child_process";
import path from "node:path";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tool = await prisma.tool.findUnique({ where: { id } });

  if (!tool || tool.type !== "plugin") {
    return NextResponse.json({ error: "Plugin not found" }, { status: 404 });
  }

  const config = JSON.parse(tool.config) as { scriptPath: string };
  const absolutePath = toAbsolutePath(config.scriptPath);
  const dir = path.dirname(absolutePath);

  // Open folder in system file explorer with the file selected
  const command =
    process.platform === "win32"
      ? `explorer /select,"${absolutePath.replace(/\//g, "\\")}"`
      : process.platform === "darwin"
        ? `open -R "${absolutePath}"`
        : `xdg-open "${dir}"`;

  // Windows explorer always returns exit code 1, so ignore errors on win32
  return new Promise<NextResponse>((resolve) => {
    exec(command, () => {
      resolve(NextResponse.json({ success: true }));
    });
  });
}
