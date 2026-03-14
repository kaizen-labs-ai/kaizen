import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getToolById } from "@/lib/tools/queries";
import { toAbsolutePath } from "@/lib/workspace";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tool = await getToolById(id);
  if (!tool) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(tool);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, description, type, config, inputSchema, outputSchema, enabled, memory } = body;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (type !== undefined) data.type = type;
  if (config !== undefined) data.config = JSON.stringify(config);
  if (inputSchema !== undefined) data.inputSchema = JSON.stringify(inputSchema);
  if (outputSchema !== undefined) data.outputSchema = JSON.stringify(outputSchema);
  if (enabled !== undefined) data.enabled = enabled;
  if (memory !== undefined) data.memory = memory;

  const tool = await prisma.tool.update({ where: { id }, data });
  return NextResponse.json(tool);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tool = await prisma.tool.findUnique({ where: { id } });
  if (!tool) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // If this is a plugin, clean up its directory from disk
  if (tool.type === "plugin") {
    try {
      const config = JSON.parse(tool.config) as { scriptPath: string };
      const pluginDir = path.dirname(toAbsolutePath(config.scriptPath));
      await fs.rm(pluginDir, { recursive: true, force: true });
    } catch {}
  }

  await prisma.tool.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
