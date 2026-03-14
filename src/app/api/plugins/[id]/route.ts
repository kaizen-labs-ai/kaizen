import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toAbsolutePath } from "@/lib/workspace";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getPluginDetail } from "@/lib/plugins/queries";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const plugin = await getPluginDetail(id);
  if (!plugin) {
    return NextResponse.json({ error: "Plugin not found" }, { status: 404 });
  }
  return NextResponse.json(plugin);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tool = await prisma.tool.findUnique({ where: { id } });

  if (!tool || tool.type !== "plugin") {
    return NextResponse.json({ error: "Plugin not found" }, { status: 404 });
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.inputSchema !== undefined) updates.inputSchema = JSON.stringify(body.inputSchema);

  // Update timeout in config if provided
  if (body.timeout !== undefined) {
    const config = JSON.parse(tool.config);
    config.timeout = body.timeout;
    updates.config = JSON.stringify(config);
  }

  // Update script content on disk if provided
  if (body.scriptContent !== undefined) {
    const config = JSON.parse(tool.config) as { scriptPath: string };
    try {
      await fs.writeFile(
        toAbsolutePath(config.scriptPath),
        body.scriptContent,
        "utf-8"
      );
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to write script: ${(err as Error).message}` },
        { status: 500 }
      );
    }
  }

  const updated = await prisma.tool.update({
    where: { id },
    data: updates,
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tool = await prisma.tool.findUnique({ where: { id } });

  if (!tool || tool.type !== "plugin") {
    return NextResponse.json({ error: "Plugin not found" }, { status: 404 });
  }

  // Remove plugin directory from disk (best-effort)
  try {
    const config = JSON.parse(tool.config) as { scriptPath: string };
    const pluginDir = path.dirname(toAbsolutePath(config.scriptPath));
    await fs.rm(pluginDir, { recursive: true, force: true });
  } catch {
    // Directory may already be gone
  }

  await prisma.tool.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
